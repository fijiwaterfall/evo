import {workerData,parentPort} from 'node:worker_threads';
import {runExperiment} from './experiment.mjs';
try{const {summary}=runExperiment({...workerData,onProgress:p=>parentPort.postMessage({type:'progress',...p})});parentPort.postMessage({type:'done',summary});}
catch(error){parentPort.postMessage({type:'error',error:error.stack});process.exitCode=1;}
