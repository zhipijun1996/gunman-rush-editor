import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const args=process.argv.slice(2),packagePath=resolve(args[0]||'game-change-package.json'),game=resolve(args.includes('--game')?args[args.indexOf('--game')+1]:'../gunman-rush');
const packageData=JSON.parse(await readFile(packagePath));if(packageData.schema!==2)throw Error('需要schema 2定稿包');
const temp=await mkdtemp(join(tmpdir(),'gunman-editor-submit-')),checkout=join(temp,'game'),output=join(temp,'prepared'),branch='editor/'+crypto.randomUUID();
const run=(bin,argv,cwd=game)=>execFileSync(bin,argv,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
run('git',['fetch','origin','main']);run('git',['worktree','add','--detach',checkout,'origin/main']);
try{
 run('git',['switch','-c',branch],checkout);
 const receipt=JSON.parse(run('python3',['tools/world/editor_apply.py',packagePath,'--output',output,'--apply'],checkout));
 if(!receipt.changes.length)throw Error('选定范围没有源文件变化');
 run('git',['add','--',...receipt.changes.map(c=>c.path)],checkout);
 run('git',['commit','-m',`采用世界工坊定稿：${receipt.rooms.join('、')}`],checkout);
 run('git',['push','-u','origin',branch],checkout);
 const body=join(temp,'pr.md');await writeFile(body,`将世界工坊审核范围写回正式JSON与世界源，保留范围外修改。\n\n- 房间：${receipt.rooms.join('、')}\n- 草稿修订：r${receipt.revision}\n- 验证：原世界编译器通过；本命令未执行真实控制器试玩。\n- 来源：${receipt.source_commit}\n`);
 console.log(run('gh',['pr','create','--repo','zhipijun1996/gunman-rush','--base','main','--head',branch,'--title',`世界工坊定稿：${receipt.rooms.length}间房`,'--body-file',body],checkout));
}finally{run('git',['worktree','remove','--force',checkout]);}
