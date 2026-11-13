import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {projectStats,validateProject} from '../packages/core/model.mjs';
import {roomVisualSignature} from '../packages/core/preview.mjs';
const args=process.argv.slice(2),game=resolve(args.includes('--game')?args[args.indexOf('--game')+1]:'../gunman-rush');
// The game owns this exporter. The editor never reimplements world compilation.
execFileSync('python3',['tools/world/export_editor_project.py'],{cwd:game,stdio:'inherit'});
const project=JSON.parse(await readFile(join(game,'build/editor/project.json'),'utf8'));
try{const tiles=JSON.parse(await readFile(resolve('apps/editor/public/previews/manifest.json'),'utf8'));for(const [rid,preview] of Object.entries(tiles.rooms)){if(!project.rooms[rid])continue;project.rooms[rid].preview={...preview,content_signature:roomVisualSignature(project.rooms[rid]),levels:preview.levels.map(level=>({...level,tiles:level.tiles.map(tile=>({...tile,url:'./previews/'+tile.url}))}))};}}catch{}
const output=resolve(args.includes('--output')?args[args.indexOf('--output')+1]:'apps/editor/public/project.json');await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(project));
console.log(JSON.stringify({output,...projectStats(project),issues:validateProject(project)},null,2));
