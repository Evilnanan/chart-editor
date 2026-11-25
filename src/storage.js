let database;
function open() {
  if (!database) database=new Promise((resolve,reject)=>{
    const request=indexedDB.open('muse-chart-studio',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('workspace');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  return database;
}
export async function readWorkspace() {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const request=db.transaction('workspace').objectStore('workspace').get('active');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
export async function saveWorkspace(value) {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('workspace','readwrite');
    transaction.objectStore('workspace').put(value,'active');
    transaction.oncomplete=resolve;
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error);
  });
}
