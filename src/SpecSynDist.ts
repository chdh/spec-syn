// Computes a spectral distribution for the spectral harmonic synthesizer.

import {UniFunction, convertDbToPowerOr0} from "./Utils.ts";
import {convertPowerToDb} from "dsp-collection/utils/DspUtils";
import * as ArrayUtils from "dsp-collection/utils/ArrayUtils";

export interface DistribParms {
   amplitudeCurveFunction:             UniFunction;                            // function input: time position [s], output: overall amplitude [dB]
   frequencyCurveFunction:             UniFunction;                            // function input: time position [s], output: fundamental frequency (f0) [Hz]
   evenAmplShift:                      number;                                 // shift [dB] for the amplitudes of the even numbered harmonics.
   duration:                           number;                                 // sound duration [s]
   distribMaxFreq:                     number;                                 // maximum frequency for the spectral distribution
   distribRes:                         number;                                 // resolution of the spectral distribution, number of histogram slots
   stepWidth:                          number; }                               // sampling step width [s] for calculating the spectral distribution

// This function computes the spectral frequency/energy distribution for the spectral
// harmonic synthesis when only the frequency curve and the amplitude curve are given.
// This distribution is displayed in the GUI to show the user which frequency regions
// of the spectrum curve are relevant for the synthesis.
// Element [i] of the output array contains a dB value corresponding to the following frequency range:
// i * d .. (i+1) * d
// Where: d = distribMaxFreq / distribRes
// The output values are normalized so that the maximum value is 0.
export function computeDistrib (dp: DistribParms) : Float64Array {
   const dist1 = new Float64Array(dp.distribRes);                              // accumulated power of the harmonics in each slot
   const timeSamples = Math.floor(dp.duration / dp.stepWidth);
   for (let timePos = 0; timePos < timeSamples; timePos++) {
      const time = timePos * dp.stepWidth;
      const a0Db = dp.amplitudeCurveFunction(time);                            // overall amplitude [dB] at current position
      const a0PowerOdd = convertDbToPowerOr0(a0Db);                            // overall power at current position, used for odd numbered harmonics
      const a0PowerEven = convertDbToPowerOr0(a0Db + dp.evenAmplShift);        // power for even numbered harmonics
      const f0 = dp.frequencyCurveFunction(time);                              // fundamental frequency at current position
      if (!Number.isFinite(f0) || f0 <= 25) {
         continue; }
      const d = dp.distribMaxFreq / dp.distribRes;                             // slot width of distribution
      const harmonics = Math.floor(dp.distribMaxFreq / f0);
      for (let harmonic = 1; harmonic <= harmonics; harmonic++) {
         const f = f0 * harmonic;                                              // frequency of this harmonic
         const i = Math.floor((f + 1E-6) / d);                                 // slot index
         if (i <= 0 || i >= dp.distribRes) {
            continue; }
         const harmonicIsEven = (harmonic % 2) == 0;
         const a0Power = harmonicIsEven ? a0PowerEven : a0PowerOdd;
         dist1[i] += a0Power; }}                                               // accumulate full power for each harmonic. In the end result, only relative power is relevant.
   const dist2 = dist1.map(convertPowerToDb);
   const dist3 = normalizeAdditiveToMax(dist2, 0);
   return dist3; }

function normalizeAdditiveToMax (a: Float64Array, newMax: number) {
   const oldMax = ArrayUtils.max(a);
   const d = newMax - oldMax;
   return a.map(x => x + d); }
