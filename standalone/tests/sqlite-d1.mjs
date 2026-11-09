import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

// Execute the production SQL against SQLite, including uniqueness constraints.
export function sqliteD1(migration) {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(migration,'utf8'));
  const statement=(sql,args=[])=>({
    bind(...next){return statement(sql,next);},
    first:async()=>sqlite.prepare(sql).get(...args)||null,
    run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}),
    all:async()=>({results:sqlite.prepare(sql).all(...args)})
  });
  const DB={prepare:sql=>statement(sql),async batch(items){
    sqlite.exec('BEGIN');
    try{const results=[];for(const item of items)results.push(await item.run());sqlite.exec('COMMIT');return results;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
  return {sqlite,DB};
}
