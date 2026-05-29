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

  // === 對外 API ===
  window.archiveTaskOnDone = async function(task, completerName){
    if(!task || !task.id || !completerName) return false;
    var key = 'char_' + completerName + '_' + BASE_SK;
    var db;
    try{
      db = await openDB();
      var existing = await readKey(db, key);
      // achievement-unlock.html 的資料結構是個物件,確保 taskArchive 在裡面
      if(!existing || typeof existing !== 'object') existing = {};
      if(!Array.isArray(existing.taskArchive)) existing.taskArchive = [];

      // 去重: 同一 taskId 對同一完成者只存一次
      var already = existing.taskArchive.some(function(a){ return a && a.taskId === task.id; });
      if(already){ try{ db.close(); }catch(_){} return false; }

      // sourceKey: 從哪讀原任務 (供活同步用)
      var sourceKey;
      // 若任務本身有 _sourceKey (central-command 注入) → 直接用
      if(task._sourceKey){
        sourceKey = task._sourceKey;
      } else if(task._isReceived || task._originalOwner){
        // 受指派任務 (ai-advisor 端)
        sourceKey = 'cross_task_' + task.id;
      } else {
        // 自己時間軸的任務
        sourceKey = 'char_' + completerName + '_ai_timeline_v1';
      }

      // snapshot 凍結當下完整狀態 (原任務刪除時 fallback 顯示)
      var snapshot = {};
      Object.keys(task).forEach(function(k){
        if(k.charAt(0)==='_') return; // 過濾內部欄位 _ownerName / _sourceKey / _isCross 等
        snapshot[k] = task[k];
      });

      existing.taskArchive.push({
        id: 'arch_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
        taskId: task.id,
        ownerName: completerName,
        sourceKey: sourceKey,
        completedAt: Date.now(),
        archivedAt: Date.now(),
        snapshot: snapshot
      });

      await writeKey(db, key, existing);
      try{ db.close(); }catch(_){}
      console.log('[task-archive] ✅ 已存入 '+completerName+' 的成就 store: '+task.id);
      triggerSync();
      return true;
    }catch(e){
      console.warn('[task-archive] 寫入失敗', e);
      try{ db && db.close(); }catch(_){}
      return false;
    }
  };
})();
