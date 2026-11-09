import type {StudyContactStore} from '../../lib/study-core.ts';

function prefixUpperBound(prefix:string):string|null {
  const characters=Array.from(prefix);
  while(characters.length) {
    const code=characters[characters.length-1].codePointAt(0)!;
    if(code<0x10ffff) {
      characters[characters.length-1]=String.fromCodePoint(code===0xd7ff?0xe000:code+1);
      return characters.join('');
    }
    characters.pop();
  }
  return null;
}

// This database is separate from research answers. Keys and JSON stay identical
// to the original draw storage so existing permits and entries remain usable.
export function createContactStore(database:D1Database):StudyContactStore {
  return {
    async put(key,value,options) {
      const condition=options?.onlyIf?.etagDoesNotMatch;
      if(condition!==undefined&&condition!=='*')throw Error('Unsupported contact storage condition');
      const sql=condition==='*'
        ? 'INSERT OR IGNORE INTO contact_objects(key,value) VALUES(?,?)'
        : 'INSERT INTO contact_objects(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value';
      const result=await database.prepare(sql).bind(key,value).run();
      return result.meta.changes?{key}:null;
    },
    async get(key) {
      const row=await database.prepare('SELECT value FROM contact_objects WHERE key=?').bind(key).first<{value:string}>();
      return row?{json:async()=>JSON.parse(row.value)}:null;
    },
    async list(options={}) {
      const prefix=options.prefix??'',limit=options.limit??1000;
      if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Invalid contact storage page size');
      let after:string|null=null;
      if(options.cursor!==undefined) {
        try {
          if(!options.cursor.startsWith('v1:'))throw Error();
          const decoded=JSON.parse(decodeURIComponent(options.cursor.slice(3)));
          if(!Array.isArray(decoded)||decoded.length!==2||decoded[0]!==prefix||typeof decoded[1]!=='string'||!decoded[1].startsWith(prefix))throw Error();
          after=decoded[1];
        }catch{throw Error('Invalid contact storage cursor');}
      }
      // A key range uses the primary-key index and treats wildcard signs literally.
      const upper=prefixUpperBound(prefix),parameters:unknown[]=[after??prefix];
      if(upper!==null)parameters.push(upper);parameters.push(limit+1);
      const query='SELECT key FROM contact_objects WHERE key'+(after===null?'>=':'>')+'?'+(upper===null?'':' AND key<?')+' ORDER BY key LIMIT ?';
      const result=await database.prepare(query).bind(...parameters).all<{key:string}>();
      const truncated=result.results.length>limit,objects=result.results.slice(0,limit).map(({key})=>({key}));
      return {...{objects,truncated},...(truncated?{cursor:'v1:'+encodeURIComponent(JSON.stringify([prefix,objects[objects.length-1].key]))}:{})};
    }
  };
}
