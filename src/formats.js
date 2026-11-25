import { zip, unzip, strToU8 } from 'fflate';
import { encode, decode } from '@msgpack/msgpack';
import { makeProject, normalizeProject, num } from './model.js';
import { parseBms, serializeBms, bmsLoss, decodeText, difficultyIndex, indexDifficulty, sceneFromBms, sceneToBms } from './bms.js';
import { parseMdcpmf, serializeMdcpmf, mdcpLoss } from './mdcpmf.js';

const fileLimit=512*1024*1024;
const chartLimit=64*1024*1024;
const audioExt=/\.(?:ogg|mp3|flac|wav|m4a|aac|opus|aiff|mp4)$/i;
const imageExt=/\.(?:png|gif|jpe?g|webp|avif|bmp)$/i;
const packageExt=/\.(?:zip|mdm)$/i;
const bmsExt=/\.(?:bms|bme|bml)$/i;
const mimeTypes={
  ogg:'audio/ogg',mp3:'audio/mpeg',wav:'audio/wav',flac:'audio/flac',m4a:'audio/mp4',opus:'audio/ogg',
  png:'image/png',gif:'image/gif',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',avif:'image/avif',mp4:'video/mp4',
};
const basename=name=>name.replaceAll('\\','/').split('/').at(-1);
const withoutExt=name=>basename(name).replace(/\.[^.]+$/,'');
const extension=name=>basename(name).split('.').at(-1).toLowerCase();
const fileName=name=>String(name || 'chart').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^[. ]+|[. ]+$/g,'').slice(0,100) || 'chart';
const MAX_CHARTS=60;

function unZip(bytes) {
  return new Promise((resolve,reject)=>{
    let total=0;
    let count=0;
    let tooLarge=false;
    unzip(bytes,{filter:file=>{
      total+=file.originalSize;
      count++;
      if(total>fileLimit||count>6000) tooLarge=true;
      return !tooLarge && !file.name.endsWith('/');
    }},(error,entries)=>{
      if(tooLarge) reject(new Error('压缩包解压后超过 512 MB，或文件数超过 6000'));
      else if(error) reject(new Error('无法解压此谱面包'));
      else resolve(entries);
    });
  });
}
const zipFiles=values=>new Promise((resolve,reject)=>zip(values,{level:0},(error,result)=>error?reject(error):resolve(result)));
const bytesOf=async blob=>new Uint8Array(await blob.arrayBuffer());
function validPath(name) {
  const path=String(name).replaceAll('\\','/');
  return path&&!path.startsWith('/')&&!path.split('/').some(part=>!part||part==='..'||part==='.'||part==='__MACOSX')&&!path.includes('\0')
    && !['__proto__','constructor','prototype'].includes(path);
}
function blobEntry(name,blob) {
  const type=mimeTypes[extension(name)];
  return {name:basename(name),blob:!blob.type && type ? blob.slice(0,blob.size,type):blob};
}
function decodeJson(bytes) {
  try {return JSON.parse(decodeText(bytes));}
  catch {throw new Error('JSON 文件无法读取');}
}
function cleanManifest(value) {
  if(!value || typeof value!=='object' || !value.meta || typeof value.meta.name!=='string' || !value.files) {
    throw new Error('Euterpe manifest.epk 格式无效');
  }
  if(value.schema!==1) throw new Error('此版本不支持该 Euterpe 清单版本');
  return value;
}

function encodeBase64(data) {
  let output='';
  for(let i=0;i<data.length;i+=24576) output+=btoa(String.fromCharCode(...data.subarray(i,i+24576)));
  return output;
}
function decodeBase64(data) {
  const plain=atob(data);
  return Uint8Array.from(plain,c=>c.charCodeAt(0));
}
async function packBackup(documents,p,assets) {
  const encodeEntry=async item=>item?{name:item.name,type:item.blob.type,data:encodeBase64(await bytesOf(item.blob))}:null;
  const extras=Object.fromEntries(await Promise.all(Object.entries(assets.extras || {}).map(async ([name,blob])=>[name,await encodeEntry({name,blob})])));
  return JSON.stringify({version:1,app:'muse-chart-studio',active:p.id,documents,assets:{
    audio:await encodeEntry(assets.audio),cover:await encodeEntry(assets.cover),extras,manifest:assets.manifest,mdmInfo:assets.mdmInfo,
  }});
}
function unpackBackup(data) {
  if(data.app!=='muse-chart-studio' || data.version!==1 || !Array.isArray(data.documents)||!data.documents.length||data.documents.length>MAX_CHARTS) throw new Error('不支持的工作室项目备份');
  const decodeEntry=item=>item?{name:item.name,blob:new Blob([decodeBase64(item.data)],{type:item.type})}:null;
  const backup=data.assets || {};
  const extras=Object.fromEntries(Object.entries(backup.extras || {}).filter(([key])=>validPath(key)).map(([key,value])=>[key,decodeEntry(value).blob]));
  const docs=data.documents.map(normalizeProject);
  docs.sort((a,b)=>(b.id===data.active)-(a.id===data.active));
  return {documents:docs,assets:{audio:decodeEntry(backup.audio),cover:decodeEntry(backup.cover),extras,manifest:backup.manifest,mdmInfo:backup.mdmInfo}};
}

export async function openFiles(files) {
  if(!files.length) throw new Error('没有选择文件');
  const size=files.reduce((sum,file)=>sum+file.size,0);
  if(size>fileLimit) throw new Error('所选文件超过 512 MB');
  const entries=new Map();
  let isMdm=false;
  for(const file of files) {
    const path=file.webkitRelativePath||file.name;
    if(!validPath(path)) continue;
    if(packageExt.test(path)) {
      isMdm ||= /\.mdm$/i.test(path);
      const values=await unZip(await bytesOf(file));
      for(const [key,data] of Object.entries(values)) {
        if(validPath(key)) entries.set(key,new Blob([data],{type:mimeTypes[extension(key)]}));
      }
    } else entries.set(path,file);
  }
  const pairs=[...entries];
  const find=name=>pairs.find(([key])=>basename(key).toLowerCase()===name.toLowerCase());
  const backupEntry=pairs.find(([path])=>/\.chart\.json$/i.test(path))
    || (pairs.length===1 && /\.json$/i.test(pairs[0][0]) ? pairs[0] : null);
  if(backupEntry) {
    const data=decodeJson(await bytesOf(backupEntry[1]));
    if(data.app==='muse-chart-studio') return unpackBackup(data);
  }
  const mf=pairs.find(([path])=>/\.mdcpmf$/i.test(path));
  const epk=find('manifest.epk')||pairs.find(([path])=>/\.epk$/i.test(path));
  const bms=pairs.filter(([path])=>bmsExt.test(path)).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}));
  const info=find('info.json');
  if(epk && epk[1].size>chartLimit) throw new Error('Euterpe 清单超过 64 MB');
  const manifest=epk?cleanManifest(decode(await bytesOf(epk[1]),{maxStrLength:2_000_000,maxMapLength:10000,maxArrayLength:10000})):null;
  const mdmInfo=info?decodeJson(await bytesOf(info[1])):null;
  const validMaps=manifest?.meta?.maps || {};
  const albums = mdmInfo ? Object.fromEntries(Object.entries(mdmInfo).map(([key,value])=>[key.toLowerCase(),value])) : {};
  const docs=[];
  if(mf) {
    if(mf[1].size>chartLimit) throw new Error('谱面数据超过 64 MB');
    docs.push(parseMdcpmf(await bytesOf(mf[1])));
  }
  if(bms.length>MAX_CHARTS) throw new Error('一个项目最多可打开 60 张难度谱');
  for(const [path,blob] of bms) {
    if(blob.size>chartLimit) throw new Error('谱面数据超过 64 MB');
    const filename=basename(path);
    const project=parseBms(await bytesOf(blob),filename);
    const index=num(filename.match(/^map([1-5])\./i)?.[1],difficultyIndex(project.difficulty));
    if(manifest) {
      const map=validMaps[String(index)] || validMaps[['easy','hard','master','hidden'][index-1]] || validMaps[withoutExt(filename)] || {};
      Object.assign(project,{name:manifest.meta.name,artist:manifest.meta.author || project.artist,
        designer:map.charters?.join(', ') || project.designer,level:String(map.rating ?? project.level),
        difficulty:indexDifficulty(index),scene:sceneFromBms(manifest.meta.scene||project.scene),format:'epk',
        packageIndex:index,packageMap:map,
      });
    } else if(isMdm||mdmInfo) {
      Object.assign(project,{name:albums.name || project.name,artist:albums.author || project.artist,
        designer:albums['leveldesigner'+index]||albums.leveldesigner||project.designer,
        level:String(albums['difficulty'+index]||project.level),difficulty:indexDifficulty(index),
        scene:sceneFromBms(albums.scene||project.scene),format:'mdm',packageIndex:index,
      });
    }
    docs.push(project);
  }
  if(!docs.length && manifest) {
    for(const [key,map] of Object.entries(validMaps)) {
      const index=num(key,({easy:1,hard:2,master:3,hidden:4})[key] || num(key.replace(/^map/,''),3));
      docs.push(makeProject({name:manifest.meta.name,artist:manifest.meta.author || '',designer:map.charters?.join(', ') || '',
        level:String(map.rating ?? '0'),difficulty:indexDifficulty(index),bpm:num(manifest.meta.bpm,128),format:'epk',
        scene:sceneFromBms(manifest.meta.scene),packageIndex:index,packageMap:map,manifestOnly:true}));
    }
    if(!docs.length) docs.push(makeProject({name:manifest.meta.name,artist:manifest.meta.author || '',bpm:num(manifest.meta.bpm,128),scene:sceneFromBms(manifest.meta.scene),format:'epk',manifestOnly:true}));
  }
  if(!docs.length) throw new Error('找不到可读取的谱面文件');
  if(docs.length>1) docs.sort((a,b)=>(b.difficulty==='master')-(a.difficulty==='master'));
  const wanted=docs.map(doc=>basename(doc.audioName));
  const audio=wanted.map(name=>find(name)).find(Boolean) || find('music.ogg') || pairs.find(([key])=>audioExt.test(key)&&!/^demo\.|^video\./i.test(basename(key)));
  const cover=pairs.find(([path])=>/^cover\./i.test(basename(path))&&imageExt.test(path)) || pairs.find(([path])=>imageExt.test(path));
  const used=new Set([mf?.[0],epk?.[0],info?.[0],audio?.[0],cover?.[0],...bms.map(([path])=>path)]);
  const extras=Object.fromEntries(pairs.filter(([key])=>!used.has(key)).map(([key,blob])=>[basename(key),blob]).filter(([key])=>validPath(key)));
  return {documents:docs,assets:{audio:audio?blobEntry(...audio):null,cover:cover?blobEntry(...cover):null,extras,manifest,mdmInfo}};
}

function assignIndexes(documents,project,maximum,includeManifestOnly=false) {
  const charts=documents.filter(chart=>includeManifestOnly || chart.id===project.id||!chart.manifestOnly);
  const ordered=[project,...charts.filter(chart=>chart.id!==project.id)];
  const assigned=new Map();
  for(const chart of ordered) {
    let index=chart.packageIndex && chart.difficulty===indexDifficulty(chart.packageIndex) ? chart.packageIndex : difficultyIndex(chart.difficulty);
    if(index>maximum) index=maximum;
    if(assigned.has(index)) index=Array.from({length:maximum},(_,i)=>i+1).find(i=>!assigned.has(i));
    if(index) assigned.set(index,chart);
  }
  return assigned;
}
function euterpeManifest(project,indexes,files,source) {
  const meta={...source?.meta};
  const bpm=Math.round(project.bpm);
  const standalone=project.manifestOnly && source && Object.keys(files).length===0;
  meta.name=project.name;
  meta.author=project.artist;
  meta.bpm=bpm;
  if(!standalone) {
    const values=Array.from(indexes.values()).flatMap(chart=>[chart.bpm,...chart.tempos.map(tempo=>tempo.bpm)]);
    const bpmMin=Math.round(Math.min(...values,bpm)),bpmMax=Math.round(Math.max(...values,bpm));
    meta.bpm_min=bpmMin===bpmMax?null:bpmMin;
    meta.bpm_max=bpmMin===bpmMax?null:bpmMax;
  }
  meta.scene=sceneToBms(project.scene);
  meta.safe_for_streamer=meta.safe_for_streamer ?? false;
  meta.maps=Object.fromEntries([...indexes].map(([index,chart])=>['map'+index,{
    ...chart.packageMap,rating:String(chart.level||'0'),
    charters:chart.designer===chart.packageMap?.charters?.join(', ') ? chart.packageMap.charters : chart.designer?[chart.designer]:[],
  }]));
  const result={schema:1,cid:null,meta,files:{}};
  if(standalone) {
    result.cid=source.cid ?? null;
    result.files=source.files;
  } else for(const [name,data] of Object.entries(files)) {
    result.files[name]={version:1,size:data.length};
  }
  return result;
}
function mdmMetadata(project,indexes,source) {
  const result={...source,name:project.name,author:project.artist,bpm:String(project.bpm),scene:sceneToBms(project.scene),levelDesigner:project.designer};
  for(let i=1;i<=5;i++) {
    const chart=indexes.get(i);
    result['difficulty'+i]=String(chart?.level || '0');
    result['levelDesigner'+i]=chart?.designer || '';
  }
  return result;
}
function coverName(format,item) {
  const ext=extension(item.name);
  if(format==='mdm'&&item.blob.type==='image/gif') return 'cover.gif';
  if(format==='epk'&&['webp','gif'].includes(ext)) return 'cover.'+ext;
  return 'cover.png';
}

export function formatLoss(format,project,documents) {
  if(format==='json') return [];
  if(format==='epk-only') return project.manifestOnly ? [] : ['谱面、音频和图像 / notes, audio and images'];
  if(format.startsWith('mdcp')) {
    return [...mdcpLoss(project),...(documents.length>1?['其他难度 / other difficulties']:[])];
  }
  const selected=format==='bms' || format==='bms-zip'?[project]:documents;
  return [...new Set([
    ...selected.flatMap(bmsLoss),
    ...(documents.length>1 && selected.length===1?['其他难度 / other difficulties']:[]),
    ...(format==='epk' && documents.length>4 ? ['超出四张的难度谱 / more than four maps'] : []),
    ...(format==='mdm' && documents.length>5 ? ['超出五张的难度谱 / more than five maps'] : []),
  ])];
}

export async function exportFile(format,project,documents,assets) {
  const slug=fileName(project.name);
  const audioName=fileName(withoutExt(project.audioName)) + '.ogg';
  if(format==='mdcpmf') return {name:'score.mdcpmf',blob:new Blob([serializeMdcpmf(project)])};
  if(format==='bms') return {name:slug+'.bms',blob:new Blob([serializeBms(project,audioName)],{type:'text/plain;charset=utf-8'})};
  if(format==='json') return {name:slug+'.chart.json',blob:new Blob([await packBackup(documents,project,assets)],{type:'application/json'})};
  const files=Object.create(null);
  if(format==='mdcp-zip') {
    files[slug+'/score.mdcpmf']=serializeMdcpmf(project);
    if(assets.audio) files[slug+'/music.ogg']=await bytesOf(assets.audio.blob);
    if(assets.cover) files[slug+'/cover.png']=await bytesOf(assets.cover.blob);
  } else if(format==='bms-zip') {
    files[slug+'.bms']=strToU8(serializeBms(project,audioName));
    if(assets.audio) files[audioName]=await bytesOf(assets.audio.blob);
    if(assets.cover) files['cover.png']=await bytesOf(assets.cover.blob);
  } else if(['mdm','epk','epk-only'].includes(format)) {
    const indexes=assignIndexes(documents,project,format==='mdm'?5:4,format==='epk-only' && project.manifestOnly);
    if(format!=='epk-only' || !project.manifestOnly) {
      for(const [index,chart] of indexes) files['map'+index+'.bms']=strToU8(serializeBms(chart,'music.ogg'));
      if(assets.audio) files['music.ogg']=await bytesOf(assets.audio.blob);
      if(assets.cover) files[coverName(format,assets.cover)]=await bytesOf(assets.cover.blob);
      for(const [name,blob] of Object.entries(assets.extras || {})) {
        if(validPath(name) && !Object.hasOwn(files,name) && name!=='manifest.epk' && name!=='info.json') files[name]=await bytesOf(blob);
      }
    }
    if(format==='mdm') files['info.json']=strToU8(JSON.stringify(mdmMetadata(project,indexes,assets.mdmInfo),null,2));
    else {
      const manifest=encode(euterpeManifest(project,indexes,files,assets.manifest),{ignoreUndefined:true});
      if(format==='epk-only') return {name:'manifest.epk',blob:new Blob([manifest],{type:'application/octet-stream'})};
      files['manifest.epk']=manifest;
    }
  } else throw new Error('未知的导出格式');
  const suffix=({mdm:'.mdm',epk:'.euterpe.zip','mdcp-zip':'.mdcp.zip','bms-zip':'.bms.zip'})[format];
  return {name:slug+suffix,blob:new Blob([await zipFiles(files)],{type:'application/zip'})};
}

export async function makePng(blob) {
  const url=URL.createObjectURL(blob);
  try {
    const image=new Image();
    image.src=url;await image.decode();
    const scale=Math.min(1,2800/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    return await new Promise((resolve,reject)=>canvas.toBlob(result=>result?resolve(result):reject(new Error('封面转换失败')),'image/png'));
  } finally {URL.revokeObjectURL(url);}
}
