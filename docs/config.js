export const API_BASE=location.hostname.endsWith('.chatgpt.site')?location.origin:'https://cloud-flow-emotion-study.christine040805.chatgpt.site';
// Keep stimuli on the same static host as the experiment, independent of the API.
export const STIMULUS_BASE=new URL('./stimuli/',import.meta.url).href;
