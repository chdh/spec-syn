// Amplitude curve analysis for SpecSyn.

import {Point} from "function-curve-editor";
import * as DspUtils from "dsp-collection/utils/DspUtils";
import * as FirFilterWin from "dsp-collection/filter/FirFilterWin";

// This function was copied from SpecFilt.
function getAmplitudeCurvePoints (signal: Float32Array, sampleRate: number, stepWidth: number) : Point[] {
   const rmsSignal = signal.map(x => x * x);                                   // signal energy
   const duration = rmsSignal.length / sampleRate;
   const stepToMinFactor = 3;                                                  // heuristic factor, we want minimal distortion from f0*2 but maximal resolution per step
   const firstMinFrequency = 1 / stepWidth * stepToMinFactor;
   const normFirstMinFreq = firstMinFrequency / sampleRate;
   const iirKernel = FirFilterWin.createFilterKernel({windowFunctionId: "blackman", normFirstMinFreq});
   const points: Point[] = [];
   for (let t = stepWidth / 2; t <= duration - stepWidth / 2; t += stepWidth) {
      const p = Math.round(t * sampleRate);
      const v = FirFilterWin.applyFirKernelAt(rmsSignal, p, iirKernel);
      const y = DspUtils.convertPowerToDb(v);
      if (isFinite(y)) {
         points.push({x: t, y}); }}
   return points; }

export interface GuiParms {                                // GUI parameters
// analAmplMethod:           string;                       // method for creating the amplitude curve
   analAmplStepWidth:        number; }                     // step width [s] for generating the knots for the editable amplitude function curve

export function analyzeAmplitudeCurve (signal: Float32Array, sampleRate: number, parms: GuiParms) : Point[] {
   return getAmplitudeCurvePoints(signal, sampleRate, parms.analAmplStepWidth); }
