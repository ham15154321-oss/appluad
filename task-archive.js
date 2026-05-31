/* ════════════════════════════════════════════════════════════════
   📦 任務完成 → 寫進完成者的 🏆 成就 store
   ════════════════════════════════════════════════════════════════
   用法: window.archiveTaskOnDone(task, completerName)
     - task: 完整任務物件 (含 id, title, content, evidenceLinks, adminLog 等)
     - completerName: 改成 done 的那位主角名 (cross_task 多人指派時，誰按 done 就算誰的)

   寫入位置: AchievementDB.data['char_<completerName>_achievement_unlock_data'].taskArchive[]
   去重: 同一 taskId 對同一人只存一次
   失敗安靜處理 (不影響原本 setTaskStatus 流程)
   寫完通知 firebase-sync.js (parent 或 self)
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
  async function _writeArchive(task, completerName, failedReason){
    if(!task || !task.id || !completerName) return false;
    var key = 'char_' + completerName + '_' + BASE_SK;
    var db;
    try{
      db = await openDB();
      var existing = await readKey(db, key);
      if(!existing || typeof existing !== 'object') existing = {};
      if(!Array.isArray(existing.taskArchive)) existing.taskArchive = [];

      // 去重: 同 taskId 對同人只存一次 (若已存在 → skip,等 live sync 反映新狀態)
      var already = existing.taskArchive.some(function(a){ return a && a.taskId === task.id; });
      if(already){ try{ db.close(); }catch(_){} return false; }

      var sourceKey;
      if(task._sourceKey) sourceKey = task._sourceKey;
      else if(task._isReceived || task._originalOwner) sourceKey = 'cross_task_' + task.id;
      else sourceKey = 'char_' + completerName + '_ai_timeline_v1';

      var snapshot = {};
      Object.keys(task).forEach(function(k){
        if(k.charAt(0)==='_') return;
        snapshot[k] = task[k];
      });

      existing.taskArchive.push({
        id: 'arch_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
        taskId: task.id,
        ownerName: completerName,
        sourceKey: sourceKey,
        completedAt: failedReason ? 0 : Date.now(),   // failed 沒有完成時間
        failedAt: failedReason ? Date.now() : 0,
        failed: !!failedReason,
        failedReason: failedReason || '',
        archivedAt: Date.now(),
        snapshot: snapshot
      });

      await writeKey(db, key, existing);
      try{ db.close(); }catch(_){}
      console.log('[task-archive] '+(failedReason?'❌ 未達成':'✅ 完成')+' 已存入 '+completerName+': '+task.id);
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
