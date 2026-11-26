import test from 'node:test';
import assert from 'node:assert/strict';
import { Transport, estimateBpm, makeDemoAudio, readAudioDetails } from '../src/audio.js';

const context={
  createBuffer(numberOfChannels,length,sampleRate) {
    const channels=Array.from({length:numberOfChannels},()=>new Float32Array(length));
    return {numberOfChannels,length,sampleRate,duration:length/sampleRate,getChannelData:i=>channels[i]};
  },
};

test('detects steady music tempos in the normal and fast ranges',async()=>{
  for(const bpm of [92,128,174,320]) {
    const track=makeDemoAudio(context,18,bpm);
    const detected=await estimateBpm(track,bpm>295);
    assert.ok(detected!==null && Math.abs(detected-bpm)<1, `expected ${bpm}, got ${detected}`);
  }
});

test('uses the right channel for peaks and tempo when the left channel is silent',async()=>{
  const melody=makeDemoAudio(context,12,112);
  const stereo=context.createBuffer(2,melody.length,melody.sampleRate);
  stereo.getChannelData(1).set(melody.getChannelData(0));
  const transport=new Transport(()=>{});
  transport.setBuffer(stereo,stereo.duration);
  assert.ok(transport.peaks.some(peak=>peak>.2));
  const detected=await estimateBpm(stereo);
  assert.ok(detected!==null && Math.abs(detected-112)<1);
});

test('rejects silence, steady tones, and insufficient audio for BPM',async()=>{
  const samples=context.createBuffer(1,22050*12,22050);
  assert.equal(await estimateBpm(samples),null);
  const tone=samples.getChannelData(0);
  for(let i=0;i<tone.length;i++) tone[i]=.5*Math.sin(2*Math.PI*i*440/samples.sampleRate);
  assert.equal(await estimateBpm(samples),null);
  assert.equal(await estimateBpm(makeDemoAudio(context,1,128)),null);
});

test('extracts song details and cover from ID3 metadata',async()=>{
  const cover=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3S8AAAAASUVORK5CYII=','base64');
  const frames=Buffer.concat([
    id3Frame('TIT2',Buffer.from('\0Tagged title')),
    id3Frame('TPE1',Buffer.from('\0Tagged artist')),
    id3Frame('TBPM',Buffer.from('\x00137')),
    id3Frame('APIC',Buffer.concat([Buffer.from('\0image/png\0\x03\0'),cover])),
  ]);
  const header=Buffer.from([73,68,51,3,0,0,0,0,frames.length>>7,frames.length&127]);
  const file=new File([header,frames,Buffer.alloc(2048)],'file name.mp3',{type:'audio/mpeg'});
  const details=await readAudioDetails(file);
  assert.equal(details.name,'Tagged title');
  assert.equal(details.artist,'Tagged artist');
  assert.equal(details.bpm,137);
  assert.equal(details.cover.name,'cover.png');
  assert.deepEqual(Buffer.from(await details.cover.blob.arrayBuffer()),cover);
});

test('falls back to the file name when audio tags cannot be read',async()=>{
  assert.deepEqual(await readAudioDetails(new File(['unreadable'],'练习曲.v2.wav')),{
    name:'练习曲.v2',artist:'',bpm:null,cover:null,
  });
});

function id3Frame(id,data) {
  const header=Buffer.alloc(10);
  header.write(id);
  header.writeUInt32BE(data.length,4);
  return Buffer.concat([header,data]);
}
