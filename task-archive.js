/* ════════════════════════════════════════════════════════════════
   📦 任務完成/未達成 → 寫進完成者的 🏆 成就 store
   ════════════════════════════════════════════════════════════════
   v3brute (2026/05/29) 粗暴修法:
     1. 寫 IDB 同時也寫 LS 鏡像 (char_<name>_task_archive_v1) → 雙保險
     2. 同 taskId 一律覆蓋,不再 skip → 修 done→failed 寫不進 bug
     3. 寫完設旗標 _taskarchive_updated 觸發 storage 事件
   ════════════════════════════════════════════════════════════════ */
(function(){
  var DB_NAME  = 'AchievementDB';
  var STORE    = 'data';
  var BASE_SK  = 'achievement_unlock_data';

  function openDB(){
    return new Promise(function(resolve, reject){
      var req = indexedDB.open(DB_NAME);
      req.onupgradeneeded = function(e){
        var db = e.target.result;
        if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function(){
        var db = req.result;
        if(db.objectStoreNames.contains(STORE)){ resolve(db); return; }
        var v = db.version; db.close();
        var up = indexedDB.open(DB_NAME, v+1);
        up.onupgradeneeded = function(e){
          var ud = e.target.result;
          if(!ud.objectStoreNames.contains(STORE)) ud.createObjectStore(STORE);
        };
        up.onsuccess = function(){ resolve(up.result); };
        up.onerror = function(){ reject(up.error); };
      };
      req.onerror = function(){ reject(req.error); };
    });
  }
  function readKey(db, key){
    return new Promise(function(resolve){
      try{
        var tx = db.transaction(STORE,'readonly');
        var g = tx.objectStore(STORE).get(key);
        g.onsuccess = function(){ resolve(g.result||null); };
        g.onerror   = function(){ resolve(null); };
      }catch(e){ resolve(null); }
    });
  }
  function writeKey(db, key, value){
    return new Promise(function(resolve, reject){
      try{
        var tx = db.transaction(STORE,'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = function(){ resolve(); };
        tx.onerror    = function(){ reject(tx.error); };
      }catch(e){ reject(e); }
    });
  }
  function triggerSync(){
    try{
      var fs = (window.parent && window.parent.firebaseSync) || window.firebaseSync;
      if(fs && fs.push) fs.push();
    }catch(e){}
  }

  // 內部:共用寫入邏輯(task + completerName + 是否 failed + 失敗理由)
  // ★★★ 粗暴修法 2026/05/29:
  //   原本「同 taskId 跳過」改成「同 taskId 一律覆蓋」,避免之前曾 archive 過(例:done→改回→failed)就寫不進來。
  async function _writeArchive(task, completerName, failedReason){
    if(!task || !task.id || !completerName){
      console.warn('[task-archive] 寫入失敗: 缺 task.id 或 completerName', task, completerName);
      return false;
    }
    var key = 'char_' + completerName + '_' + BASE_SK;
    var db;
    try{
      db = await openDB();
      var existing = await readKey(db, key);
      if(!existing || typeof existing !== 'object') existing = {};
      if(!Array.isArray(existing.taskArchive)) existing.taskArchive = [];

      var sourceKey;
      if(task._sourceKey) sourceKey = task._sourceKey;
      else if(task._isReceived || task._originalOwner) sourceKey = 'cross_task_' + task.id;
      else sourceKey = 'char_' + completerName + '_ai_timeline_v1';

      var snapshot = {};
      Object.keys(task).forEach(function(k){
        if(k.charAt(0)==='_') return;
        snapshot[k] = task[k];
      });

      var newEntry = {
        id: 'arch_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
        taskId: task.id,
        ownerName: completerName,
        sourceKey: sourceKey,
        completedAt: failedReason ? 0 : Date.now(),
        failedAt: failedReason ? Date.now() : 0,
        failed: !!failedReason,
        failedReason: failedReason || '',
        archivedAt: Date.now(),
        snapshot: snapshot
      };

      // ★ 同 taskId 一律覆蓋(用 filter 排掉舊的,再 push 新的)
      var beforeCnt = existing.taskArchive.length;
      existing.taskArchive = existing.taskArchive.filter(function(a){ return !a || a.taskId !== task.id; });
      var removedCnt = beforeCnt - existing.taskArchive.length;
      existing.taskArchive.push(newEntry);

      await writeKey(db, key, existing);
      try{ db.close(); }catch(_){}

      // ★★★ v3brute: LS 鏡像備份(防 IDB 被 firebase 同步覆蓋 / IDB 寫失敗時的雙保險)
      var mirrorKey = 'char_' + completerName + '_task_archive_v1';
      try{
        var pLS = (window.parent && window.parent !== window) ? window.parent.localStorage : localStorage;
        pLS.setItem(mirrorKey, JSON.stringify(existing.taskArchive));
        console.log('[task-archive] LS 鏡像已寫入 '+mirrorKey);
      }catch(e){
        console.warn('[task-archive] LS 鏡像寫入失敗(可能 quota 滿)', e);
        try{ localStorage.setItem(mirrorKey, JSON.stringify(existing.taskArchive)); }catch(_){}
      }

      console.log('[task-archive v3brute] '+(failedReason?'❌ 未達成':'✅ 完成')+' 已存入 '+completerName+': '+task.id+(removedCnt?' (覆蓋舊 entry × '+removedCnt+')':'')+' | total='+existing.taskArchive.length);

      // 通知所有同 origin 頁面重新整理(achievement-unlock 才知道要 reload)
      try{ localStorage.setItem('_taskarchive_updated', String(Date.now())); }catch(_){}
      try{
        var pLS2 = (window.parent && window.parent !== window) ? window.parent.localStorage : null;
        if(pLS2) pLS2.setItem('_taskarchive_updated', String(Date.now()));
      }catch(_){}

      triggerSync();
      return true;
    }catch(e){
      console.warn('[task-archive] 寫入失敗', e);
      try{ db && db.close(); }catch(_){}
      return false;
    }
  }

  // === 對外 API ===
  // ✅ 完成歸檔
  window.archiveTaskOnDone = function(task, completerName){
    return _writeArchive(task, completerName, '');
  };
  // ❌ 未達成歸檔 (黃柏翰確認後寫入,紅卡呈現)
  window.archiveTaskAsFailed = function(task, completerName, reason){
    return _writeArchive(task, completerName, reason || '未指定理由');
  };
})();
