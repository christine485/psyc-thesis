export const API_BASE=location.hostname.endsWith('.chatgpt.site')?location.origin:'https://cloud-flow-emotion-study.christine040805.chatgpt.site';
export const STIMULUS_BASE=location.hostname.endsWith('.github.io')?API_BASE+'/experiment/stimuli/':'./stimuli/';
