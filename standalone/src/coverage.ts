import {PROTOCOL,STIMULI} from '../../docs/modules/protocol.mjs';

export interface ImageCoverage {
  file: string;
  condition: string;
  assessments: number;
  validAssessments: number;
  wordRatings: number;
}

interface CoverageRow {
  file: string;
  assessments: number;
  validAssessments: number;
  wordRatings: number;
}

// Aggregate inside D1 so the Worker receives at most 270 small rows, rather
// than parsing every questionnaire. Only completed main trials contribute;
// attention trials are separate and named-word counts remain observational.
export async function studyCoverage(database:D1Database,mode:string):Promise<{
  protocol:string;
  mode:'pilot'|'live';
  images:ImageCoverage[];
  totalSubmitted:number;
}> {
  if(mode!=='pilot'&&mode!=='live')throw Error('Invalid coverage mode');
  const result=await database.prepare(`
    SELECT json_extract(response.value,'$.stimulus') AS file,
           COUNT(*) AS assessments,
           SUM(CASE WHEN json_extract(slot.payload,'$.validQuestionnaire')=1 THEN 1 ELSE 0 END) AS validAssessments,
           SUM(COALESCE(json_array_length(response.value,'$.words'),0)) AS wordRatings
    FROM slots AS slot
    CROSS JOIN json_each(slot.payload,'$.responses') AS response
    WHERE slot.mode=? AND slot.submitted=1
      AND json_extract(response.value,'$.type')='main'
    GROUP BY json_extract(response.value,'$.stimulus')
  `).bind(mode+':'+PROTOCOL).all<CoverageRow>();

  const known=new Set(STIMULI.map(stimulus=>stimulus.file));
  for(const row of result.results){
    if(!known.has(row.file)||![row.assessments,row.validAssessments,row.wordRatings].every(value=>Number.isSafeInteger(value)&&value>=0)||row.validAssessments>row.assessments||row.wordRatings>row.assessments*9){
      throw Error('Stored coverage data is inconsistent');
    }
  }
  const counts=new Map(result.results.map(row=>[row.file,row]));
  const images:ImageCoverage[]=STIMULI.map(stimulus=>{
    const row=counts.get(stimulus.file);
    return {file:stimulus.file,condition:stimulus.condition,assessments:row?.assessments??0,validAssessments:row?.validAssessments??0,wordRatings:row?.wordRatings??0};
  });
  const totalMainAssessments=images.reduce((sum,image)=>sum+image.assessments,0);
  // Successful submissions contain exactly 27 main trials. One SQL statement
  // sees one consistent snapshot even if another participant submits meanwhile.
  const totalSubmitted=totalMainAssessments/27;
  if(!Number.isSafeInteger(totalSubmitted))throw Error('Stored main-trial coverage is incomplete');
  return {protocol:PROTOCOL,mode,images,totalSubmitted};
}
