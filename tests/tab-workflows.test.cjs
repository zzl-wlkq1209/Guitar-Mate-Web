const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const html = fs.readFileSync('public/tab-player/index.html', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

test('practice selection supports one measure, either direction, and deselection', () => {
  const code = html.slice(html.indexOf('    function practiceBounds()'), html.indexOf('    let audioContext'));
  const ctx = vm.createContext({ els: { sectionPractice: { checked: true } }, score: { totalBeats: 36, beatsPerMeasure: 4 } });
  vm.runInContext('let practiceRange = null; let practiceAnchor = null;\n' + code, ctx);
  const read = () => JSON.parse(vm.runInContext('JSON.stringify({range:practiceRange,bounds:practiceBounds()})', ctx));
  vm.runInContext('selectPracticeMeasure(3)', ctx);
  assert.deepEqual(read(), { range: [3, 3], bounds: { start: 12, end: 16 } });
  vm.runInContext('selectPracticeMeasure(1)', ctx);
  assert.deepEqual(read().range, [1, 3]);
  vm.runInContext('selectPracticeMeasure(2)', ctx);
  assert.equal(read().range, null);
  vm.runInContext('selectPracticeMeasure(0);selectPracticeMeasure(0)', ctx);
  assert.equal(read().range, null);
  vm.runInContext('selectPracticeMeasure(1);selectPracticeMeasure(4)', ctx);
  assert.deepEqual(read().range, [1, 4]);
  vm.runInContext('score.beatsPerMeasure=3; score.totalBeats=13', ctx);
  assert.deepEqual(read().bounds, { start: 3, end: 13 });
  vm.runInContext('els.sectionPractice.checked=false', ctx);
  assert.deepEqual(read().bounds, { start: 0, end: 13 });
});

function transferContext() {
  const storage = new Map();
  const ctx = vm.createContext({
    console, File, JSON, Date, TAB_LIBRARY_KEY: 'tabs', STORAGE_KEY: 'strum', TAB_PREFERENCE_KEYS: [], ACTIVE_TOOL_KEY: 'tool', slotCount: 16,
    window: { localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) }, location: { reload() { throw Error('Unexpected reload'); } } },
    document: { querySelector: () => ({ contentWindow: { postMessage() {} } }) },
    readTabLibrary: () => JSON.parse(storage.get('tabs') || '[]'), makeTabScoreId: (() => { let id=0; return () => `test-${++id}`; })(),
    setShareStatus: s => ctx.status = s,
    importSharedPayload: p => { if (p.kind !== 'guitar-mate-pattern-share') return null; ctx.strumImports++; return {addedPatterns: 2}; },
    stop() {}, setSelectedId() {}, setCustomName() {}, setAdvancedMode() {}, setSlots() {}, normalizeSlots: s => s,
    strumImports: 0,
  });
  const code = app.slice(app.indexOf('  const mergeTabLibrary ='), app.indexOf('  const importPattern ='));
  vm.runInContext(ts.transpile('let playerOnlyImport = false;\n' + code), ctx);
  return { ctx, storage, run: code => vm.runInContext(code, ctx) };
}

test('score imports deduplicate all semantic fields, not just the tab text', async () => {
  const { ctx, storage, run } = transferContext();
  ctx.payload = {format:'guitar-tab-player', scores:[{name:'测试',artist:'歌手',tab:'@C',bpm:60},{name:'测试',artist:'歌手',tab:'@C',bpm:60},{name:'同谱不同名称',artist:'歌手',tab:'@C',bpm:60}]};
  await run('importTransferFile(new File([JSON.stringify(payload)],"test.json"))');
  assert.equal(JSON.parse(storage.get('tabs')).length, 2);
  await run('importTransferFile(new File([JSON.stringify(payload)],"test.json"))');
  assert.equal(JSON.parse(storage.get('tabs')).length, 2);
});

test('player import rejects strumming data; global import routes combined envelopes', async () => {
  const { ctx, storage, run } = transferContext();
  ctx.payload = {kind:'guitar-mate-share',version:1, strum:{kind:'guitar-mate-pattern-share',workspaces:{}},tabPlayer:{scores:[{name:'测试',tab:'@C'}]}};
  run('playerOnlyImport = true');
  await run('importTransferFile(new File([JSON.stringify(payload)],"test.json"))');
  assert.match(ctx.status, /导入失败/);
  assert.equal(ctx.strumImports, 0);
  assert.equal(storage.size, 0);
  run('playerOnlyImport = false');
  await run('importTransferFile(new File([JSON.stringify(payload)],"test.json"))');
  assert.equal(JSON.parse(storage.get('tabs')).length, 1);
  assert.equal(ctx.strumImports, 1);
});

test('cloud envelopes keep global scope separate from individual score selections', () => {
  const code = app.slice(app.indexOf('  const transferPayload ='), app.indexOf('  const createShareCode ='));
  const ctx = vm.createContext({readTabLibrary:()=>[{tab:'entire-library'}],createSharePayload:()=>({kind:'guitar-mate-pattern-share'})});
  vm.runInContext(ts.transpile('let transferScope="all"; let tabTransferScores=null;\n'+code),ctx);
  const read = () => JSON.parse(vm.runInContext('JSON.stringify(transferPayload())',ctx));
  assert.ok(read().strum && read().tabPlayer);
  vm.runInContext('transferScope="tab"',ctx);
  assert.equal(read().strum,undefined);
  vm.runInContext('tabTransferScores=[{tab:"selected-one"}]',ctx);
  assert.equal(read().scope,'tab-selection');
  assert.deepEqual(read().tabPlayer.scores,[{tab:'selected-one'}]);
  vm.runInContext('tabTransferScores=null;transferScope="strum"',ctx);
  assert.equal(read().tabPlayer,undefined);
});

test('score layout stays local and compact mobile lines never exceed 25 source columns', () => {
  const code = html.slice(html.indexOf('    function scoreLineMeasureGroups('), html.indexOf('    function buildDisplaySystems()'));
  const ctx = vm.createContext({ window: { innerWidth: 527 }, els: { layout: { value: 'timed' } }, score: { measureColumnWidths: [8, 9, 10, 15, 7] } });
  vm.runInContext(code, ctx);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(scoreLineMeasureGroups(5))', ctx)), [
    { first: 0, count: 1 }, { first: 1, count: 1 }, { first: 2, count: 1 }, { first: 3, count: 1 }, { first: 4, count: 1 },
  ]);
  vm.runInContext('els.layout.value="compact"', ctx);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(scoreLineMeasureGroups(5))', ctx)), [
    { first: 0, count: 2 }, { first: 2, count: 2 }, { first: 4, count: 1 },
  ]);
  const capture = html.slice(html.indexOf('    function captureScoreDocument('), html.indexOf('    function renderScoreLibrary()'));
  assert.doesNotMatch(capture, /layout:\s*els\.layout/);
  assert.doesNotMatch(app, /score\.layout\s*\|\|\s*"compact"/);
});

test('content validation fills leading empty beats with merged rests', () => {
  const code = html.slice(html.indexOf('    function restTokensForDuration('), html.indexOf('    function convertChordFingeringNumbersToX('));
  const ctx = vm.createContext({
    els: { beats: { value: '4/4' } },
    restDuration: token => ({ R2: 4, R1: 2, R: 1, r: .5, r1: .25, r2: .125, r3: .0625 })[token],
    barPositions: row => [...row].flatMap((char, index) => char === '|' ? [index] : []),
    rhythmInfo: () => ({ duration: 1 }),
  });
  vm.runInContext(code, ctx);
  ctx.input = '@\n|------0|\n|-------|\n|-------|\n|-------|\n|-------|\n|-------|';
  const output = vm.runInContext('completeMeasurePadding(input).text', ctx);
  assert.match(output, /\|R1R-+\|/);
});

test('audio scheduling excludes notes outside selected measures and cuts audio at range end', async () => {
  const code = html.slice(html.indexOf('    async function scheduleFrom('), html.indexOf('    function currentBeat()'));
  const sources = [];
  const node = () => ({ connect() { return this; }, gain:{value:0},pan:{value:0} });
  const ctx = vm.createContext({
    playbackGeneration:0,score:{events:[0,4,8].map(beat=>({beat,midi:60,stringIndex:2}))},
    audioContext:{currentTime:0,createBufferSource(){const s={...node(),playbackRate:{setValueAtTime(){}},start(t){this.started=t},stop(t){this.stopped=t}};sources.push(s);return s;},createGain:node,createStereoPanner:node},
    ensureAudio(){}, async loadSampleBank(){},stopSources(){},getBpm:()=>60,practiceBounds:()=>({start:4,end:8}),
    getCapo:()=>0,nearestSample:()=>null,pluckBuffer:()=>({}),els:{tone:{value:'acoustic'},autoScroll:{checked:true}},
    masterGain:{},activeSources:[],document:{body:{classList:{add(){},toggle(){}}}},updatePlayButton(){},cancelAnimationFrame(){},requestAnimationFrame:()=>1,tick(){},rafId:0,
  });
  vm.runInContext(code,ctx);
  await vm.runInContext('scheduleFrom(4)',ctx);
  assert.equal(sources.length,1);
  assert.equal(sources[0].started,.08);
  assert.equal(sources[0].stopped,4.08);
});

test('every section loop schedules a fresh count-in when enabled', () => {
  const code = html.slice(html.indexOf('    function tick()'), html.indexOf('    function updateNowPlaying('));
  const calls = [];
  const ctx = vm.createContext({score:{totalBeats:36},currentBeat:()=>16,hostLatencyMs:0,playbackBpm:60,
    els:{fill:{style:{}},position:{},loop:{checked:true},countIn:{checked:true}},
    formatTime:()=>'',secondsForBeat:()=>0,updateNowPlaying(){},setPlayheadPosition(){},
    practiceBounds:()=>({start:8,end:16}),stopSources(){},document:{body:{classList:{remove(){}}}},updatePlayButton(){},
    scheduleFrom:(beat,options)=>calls.push({beat,...options}),requestAnimationFrame(){},playing:true});
  vm.runInContext(code,ctx);
  vm.runInContext('tick();tick();tick()',ctx);
  assert.deepEqual(calls,[{beat:8,countIn:true},{beat:8,countIn:true},{beat:8,countIn:true}]);
});

test('mobile beforeinput routes printable characters and deletion through structural editing', () => {
  const inputBlock = html.slice(html.indexOf('    els.tab.addEventListener("beforeinput"'), html.indexOf('    els.tab.addEventListener("compositionstart"'));
  assert.match(inputBlock, /applyCommittedEditorText\(event\.data\)/);
  assert.match(inputBlock, /applyMobileDelete\("backward"\)/);
  assert.match(inputBlock, /applyMobileDelete\("forward"\)/);
  assert.match(inputBlock, /event\.isComposing \|\| compositionSnapshot/);
  const committed = html.slice(html.indexOf('    function applyCommittedEditorText('), html.indexOf('    function handleEditorHistoryKey('));
  assert.match(committed, /character === "%"/);
  assert.match(committed, /character === "-"/);
  assert.match(committed, /character === "\|"/);
  assert.match(committed, /character === " "/);
  assert.match(committed, /replaceTabCharacter\(caret, character\)/);
});
