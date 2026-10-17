import { PitchPipeline } from '../dsp/pitch-pipeline';

class PitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [
    {name:'pitchRatio',defaultValue:1,minValue:.25,maxValue:4,automationRate:'k-rate'},
    {name:'independent',defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'},
  ];}
  private readonly pipeline=new PitchPipeline(sampleRate);
  private disposed=false;
  private blocks=0;
  constructor(){
    super();
    this.port.onmessage=(event:MessageEvent<{type:string}>)=>{
      if(event.data.type==='reset')this.pipeline.reset();
      if(event.data.type==='dispose'){this.pipeline.reset();this.disposed=true;}
    };
  }
  process(inputs:Float32Array[][],outputs:Float32Array[][],parameters:Record<string,Float32Array>):boolean {
    const output=outputs[0];if(!output?.[0])return !this.disposed;
    const left=inputs[0]?.[0],right=inputs[0]?.[1]??left;
    if(this.disposed||!left||!right){for(const channel of output)channel.fill(0);return !this.disposed;}
    try{
      this.pipeline.process(left,right,output[0],output[1]??output[0],parameters.pitchRatio[0],parameters.independent[0]>=.5);
      if(++this.blocks%100===0)this.port.postMessage({type:'metrics',underruns:this.pipeline.underruns,bufferedFrames:this.pipeline.bufferedFrames,latencyFrames:this.pipeline.latencyFrames});
      return true;
    }catch(cause){
      for(const channel of output)channel.fill(0);this.disposed=true;
      this.port.postMessage({type:'fault',message:cause instanceof Error?cause.message:'Pitch processing failed.'});
      return false;
    }
  }
}
registerProcessor('rimvo-pitch',PitchProcessor);
