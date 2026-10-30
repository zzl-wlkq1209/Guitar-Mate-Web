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

test('score layout stays local and compact mobile lines group by rendered onset columns', () => {
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

test('chord labels stay anchored atomically and frets above 20 split into separate notes', () => {
  const code = html.slice(html.indexOf('    function chordMarkers('), html.indexOf('    function barPositions('));
  const ctx = vm.createContext({});
  vm.runInContext(code, ctx);
  assert.equal(vm.runInContext('rebuildChordLine("@ Cmaj7      G", 5, "insert")', ctx), '@ Cmaj7       G');
  assert.equal(vm.runInContext('rebuildChordLine("@ Cmaj7      G", 2, "insert")', ctx), '@  Cmaj7      G');
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(fretTokenAt("20",0))', ctx)), { text: '20', length: 2, fret: 20 });
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(fretTokenAt("21",0))', ctx)), { text: '2', length: 1, fret: 2 });
});

test('validation separates adjacent notes while extending the preceding rhythm beam', () => {
  const helpers = html.slice(html.indexOf('    function chordMarkers('), html.indexOf('    function barPositions('));
  const separator = html.slice(html.indexOf('    function separateAdjacentFrettedNotes('), html.indexOf('    function applyTabTextConversion('));
  const ctx = vm.createContext({});
  vm.runInContext(helpers + separator, ctx);
  ctx.input = '@C\n|5x5|\n|---|\n|---|\n|---|\n|---|\n|---|\n%-==';
  const result = JSON.parse(vm.runInContext('JSON.stringify(separateAdjacentFrettedNotes(input))', ctx));
  assert.equal(result.insertedColumns, 2);
  assert.equal(result.text, '@C  \n|5-x-5|\n|-----|\n|-----|\n|-----|\n|-----|\n|-----|\n%--===');
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

test('content validation places the whole missing beat before the first note', () => {
  const code = html.slice(html.indexOf('    function restTokensForDuration('), html.indexOf('    function convertChordFingeringNumbersToX('));
  const ctx = vm.createContext({
    els: { beats: { value: '4/4' } },
    restDuration: token => ({ R2: 4, R1: 2, R: 1, r: .5, r1: .25, r2: .125, r3: .0625 })[token],
    barPositions: row => [...row].flatMap((char, index) => char === '|' ? [index] : []),
    rhythmInfo: column => ({ duration: [5,7,9,11,13,15].includes(column) ? .5 : 1 }),
  });
  vm.runInContext(code, ctx);
  ctx.input = '@C\n|--------0-------|\n|----1-------1---|\n|------0---0---0-|\n|----------------|\n|----------------|\n|----------------|\n%    --- --- ---  ';
  const output = vm.runInContext('completeMeasurePadding(input).text', ctx);
  assert.match(output, /\|R---------------\|/);
  assert.doesNotMatch(output, /\|[^\n]*=\|/);
});

test('replace paste overwrites content and only grows the measure by the missing width', () => {
  const code = html.slice(html.indexOf('    function ensureRhythmRows('), html.indexOf('    let columnDragActive'));
  const ctx = vm.createContext({
    barPositions: row => [...row].flatMap((char, index) => char === '|' ? [index] : []),
    rebuildChordLine: line => line,
    tabRowType: (block, line) => line <= block.blockStart + 6 ? 'string' : 'rhythm',
    tabRowFiller: (block, line) => line <= block.blockStart + 6 ? '-' : ' ',
    tabBlockForLine: (lines, line) => ({ blockStart: 0, blockEnd: 7 }),
    chordMarkers: () => [], chordLineFromMarkers: () => '@',
  });
  vm.runInContext(code, ctx);
  ctx.lines = ['@C','|----35|','|------|','|------|','|------|','|------|','|------|','%      '];
  vm.runInContext('ensurePasteCapacity(lines,0,7,3,5);writePasteRow(lines,0,1,3,"75777","replace")', ctx);
  assert.equal(ctx.lines[1], '|--75777|');
  assert.equal(ctx.lines[2].length, ctx.lines[1].length);
});

test('measured paste maps source measures independently and preserves target bars', () => {
  const code = html.slice(html.indexOf('    function ensureRhythmRows('), html.indexOf('    let columnDragActive'));
  const ctx = vm.createContext({
    barPositions: row => { const bars=[...row].flatMap((char,index)=>char==='|'?[index]:[]); return bars.length>=2?bars:[0,Math.max(1,row.length-1)]; },
    rebuildChordLine: (line, column, mode) => mode === 'insert' ? line.slice(0,column)+' '+line.slice(column) : line,
    tabRowType: (block,line) => line <= block.blockStart + 6 ? 'string' : 'rhythm',
    tabRowFiller: (block,line) => line <= block.blockStart + 6 ? '-' : ' ',
    tabBlockForLine: () => ({blockStart:0,blockEnd:7}), chordMarkers:()=>[], chordLineFromMarkers:()=> '@',
  });
  vm.runInContext(code, ctx);
  ctx.lines=['@      ','|--|--|','|--|--|','|--|--|','|--|--|','|--|--|','|--|--|','%      '];
  ctx.location={lineIndex:1,column:1};
  vm.runInContext('writeMeasuredPasteRows(lines,0,7,location,["|5---|7|"])',ctx);
  assert.equal(ctx.lines[1], '|5---|7-|');
  assert.equal([...ctx.lines[1]].filter(char=>char==='|').length, 3);
  assert.ok(ctx.lines.slice(1,7).every(row=>[...row].filter(char=>char==='|').length===3));
});

test('shift deletion removes the whole selected column range across the block', () => {
  const code = html.slice(html.indexOf('    function selectedColumnRange('), html.indexOf('    function handleDashInput('));
  const ctx = vm.createContext({
    els: { tab: { value: '', selectionStart: 0, selectionEnd: 0 } },
    normalizedColumnSelection: () => null,
    textLocationAtOffset: () => ({}), tabBlockForLine: () => null,
    barPositions: row => [...row].flatMap((char, index) => char === '|' ? [index] : []),
    chordMarkers: () => [{ column: 1, name: 'C' }],
    chordLineFromMarkers: () => '@C',
    tabRowFiller: (block, line) => line <= block.blockStart + 6 ? '-' : ' ',
    clearColumnSelection() {},
    commitTabLines(value, lines) { ctx.result = lines; },
  });
  vm.runInContext(code, ctx);
  ctx.lines = ['@C','|----35|','|------|','|------|','|------|','|------|','|------|','%      '];
  ctx.block = { value: ctx.lines.join('\n'), lines: ctx.lines, blockStart: 0, blockEnd: 7, lineIndex: 1, column: 3 };
  vm.runInContext('deleteTabColumnRange(block,3,7)', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.result.slice(1, 7))), Array(6).fill('|--|'));
  assert.equal(ctx.result[7], '%  ');
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
  assert.match(committed, /rowType === "string"\) editTabColumn\("insert", "-"\)/);
  assert.doesNotMatch(committed, /rowType === "rhythm"\) insertTabColumnWithCurrentValue/);
  const desktopDash = html.slice(html.indexOf('    function handleDashInput('), html.indexOf('    function handleClearKey('));
  assert.match(desktopDash, /tabRowType\(block\) === "string"/);
  assert.doesNotMatch(desktopDash, /insertTabColumnWithCurrentValue/);
  const mobileDelete = html.slice(html.indexOf('    function applyMobileDelete('), html.indexOf('    function handleEditorHistoryKey('));
  assert.doesNotMatch(mobileDelete, /editTabColumn\("delete"\)/);
  assert.match(html, /event\.altKey && event\.key\.toLowerCase\(\) === "v"/);
  assert.match(html, /els\.tab\.focus\(\{ preventScroll: true \}\)/);
  assert.match(html, /deleteTabColumnRange\(block, selection\.left, selection\.right\)/);
});

test('editor keeps native complete selections, IME text, and a trailing creation line', () => {
  assert.match(html, /selection\.kind !== "caret"\) return/);
  assert.match(html, /selection\.kind === "partial-multiline"/);
  assert.match(html, /function ensureTrailingEditorBlankLine\(\)/);
  assert.match(html, /els\.tab\.value \+= "\\n"/);
  const composition = html.slice(html.indexOf('    els.tab.addEventListener("compositionstart"'), html.indexOf('    function replaceTabCharacter('));
  assert.doesNotMatch(composition, /els\.tab\.value = snapshot\.value/);
  assert.match(composition, /dispatchEvent\(new Event\("input"/);
});

test('blank creation line scaffolds blocks and rhythm rows, while columns use custom clipboard MIME', () => {
  assert.match(html, /function emptyTabBlock\(width = 16\)/);
  assert.match(html, /scaffoldBlockAtBlankLine\(event\.key\)/);
  assert.match(html, /TAB_COLUMN_MIME/);
  assert.match(html, /setData\(TAB_COLUMN_MIME, JSON\.stringify\(payload\)\)/);
  assert.match(html, /window\.matchMedia\("\(hover: none\), \(pointer: coarse\)"\)/);
});

test('preview renders unresolved x at the string and deduplicates measure messages', () => {
  assert.match(html, /score-unresolved-x-ring/);
  assert.match(html, />x<\/text>/);
  assert.match(html, /labels = \[\.\.\.new Set\(parseIssues/);
  assert.doesNotMatch(html, /⚠ \$\{labels/);
  assert.match(html, /measureIssueOverlay \+= `<rect class="timing-issue-bg"/);
  assert.match(html, /svg \+= measureIssueOverlay;\s*svg \+= unresolvedOverlay/);
});

test('undefined chords use the same red capsule language as timing issues', () => {
  const diagram=html.slice(html.indexOf('    function diagramSvg('),html.indexOf('    function buildSystemLayout('));
  assert.match(diagram,/if \(!shape\)/);
  assert.match(diagram,/class="timing-issue-bg"/);
  assert.match(diagram,/class="timing-issue-text"/);
  assert.match(diagram,/>和弦未定义<\/text>/);
});

test('selected chord text is overwritten at fixed width from the left edge', () => {
  const code = html.slice(html.indexOf('    function fixedWidthSelectionBounds('), html.indexOf('    let editorHistory'));
  const value='@    G6add9   E7  \n|----------------|\n|----------------|\n|----------------|\n|----------------|\n|----------------|\n|----------------|\n%                 \n';
  const ctx=vm.createContext({
    els:{tab:{value}},
    textLocationAtOffset(value,offset){const lines=value.split('\n');let run=0;for(let i=0;i<lines.length;i++){if(offset<=run+lines[i].length)return{lines,lineIndex:i,column:offset-run};run+=lines[i].length+1;}},
    tabBlockForLine:()=>({blockStart:0,blockEnd:7}),
    chordMarkers:line=>[...line.replace('@',' ').matchAll(/\S+/g)].map(match=>({column:match.index,name:match[0]})),
    tabRowFiller:()=> ' ', normalizeCommittedAscii:text=>text,
    commitTabLines(original,lines,line,column){ctx.result={lines,line,column};},
  });
  vm.runInContext(code,ctx);
  const start=value.indexOf('G6add9');
  vm.runInContext(`replaceFixedWidthSelection(${start},${start+6},"C")`,ctx);
  assert.equal(ctx.result.lines[0].length,18);
  assert.equal(ctx.result.lines[0],'@    C        E7  ');
  assert.equal(ctx.result.column,6);
});

test('ctrl-v falls back to the last structured column payload when custom mime is unavailable', () => {
  const paste=html.slice(html.indexOf('    els.tab.addEventListener("paste"'),html.indexOf('    document.addEventListener("copy"'));
  assert.match(paste,/lastColumnClipboard\?\.text === text/);
  assert.match(paste,/pasteColumnPayload\(payload, "replace"\)/);
});
