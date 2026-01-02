// Spectral analysis for SpecSyn.

// The spectrum smoothing algorithms used here were devised using the routines of the SpecFilt module SpecAverage.ts.

import {Point} from "function-curve-editor";
import * as DspUtils from "dsp-collection/utils/DspUtils";
import * as WindowFunctions from "dsp-collection/signal/WindowFunctions";
import * as Fft from "dsp-collection/signal/Fft";
import * as FirFilterWin from "dsp-collection/filter/FirFilterWin";
import * as MathUtils from "dsp-collection/math/MathUtils";

export interface GuiParms {                                // GUI parameters
   f0Reference:              number;                       // reference value for the fundamental frequency
   analSpecMethod:           string;                       // method for creating the smoothed spectrum curve
   analSpecWidth1:           number;                       // filter window width for the first FIR LP filter, relative to f0Reference
   analSpecFunc1:            string;                       // filter window function used for the first FIR LP filter
   analSpecWidth2:           number;                       // filter window width for the second FIR LP filter, relative to f0Reference
   analSpecFunc2:            string;                       // filter window function used for the second FIR LP filter
   analSpecMaxFreq:          number;                       // maximum frequency for the spectrum calculation in Hz
   analSpecStepWidth:        number;                       // step width [Hz] for generating the knots for the editable spectrum function curve
   analSpecWindowFunc:       string; }                     // window function to apply before the FFT

function filterArray (signal: Float64Array, filterSpec: FirFilterWin.FilterSpec) : Float64Array {
   if (filterSpec.windowFunctionId == "none") {
      return signal; }
   return FirFilterWin.filterArray(signal, filterSpec); }

// SMA power + 2x SMA log.
// The first SMA is performed on the power amplitudes.
// The second and third SMA is performed on the log amplitudes.
// This function was copied from SpecFilt.SpecAverage.
function createSpectrumAverage_smaPwrLog2 (spectrum: Float64Array, averagingWidth: number) : Float64Array {
   if (averagingWidth < 8) {
      throw new Error("averagingWidth too small."); }
   const spectrumSqr = spectrum.map(x => x * x);                                                   // power values
   const averagedSpectrumSqr = MathUtils.simpleMovingAverage(spectrumSqr, averagingWidth);         // first SMA (power values)
   const specLog1 = averagedSpectrumSqr.map(DspUtils.convertPowerToDb);                            // convert to log
   const averagingWidth2 = Math.round(averagingWidth / 2);
// const averagingWidth2 = Math.round(averagingWidth / 2 / Math.sqrt(2));
   const specLog2 = MathUtils.simpleMovingAverage(specLog1, averagingWidth2);                      // second SMA (log values)
   const averagingWidth3 = Math.round(averagingWidth2 / 2);
// const averagingWidth3 = averagingWidth2;
   return MathUtils.simpleMovingAverage(specLog2, averagingWidth3); }                              // third SMA (log values)

// Dual FIR LP filter (1x power + 1x log).
// This function was copied from SpecFilt.SpecAverage.
function createSpectrumAverage_firLpPwrLog (spectrum: Float64Array, averagingWidth: number, averagingWindowFunctionId: string, averagingWidth2: number, averagingWindowFunctionId2: string) : Float64Array {
   const a1 = spectrum.map(x => x * x);                                                                // power values
   const a2 = filterArray(a1, {windowFunctionId: averagingWindowFunctionId, width: averagingWidth});   // first filter, power values
   const a3 = a2.map((x) => Math.max(0, x));                                                           // clip because "flat top" window can produce negative values
   const a4 = a3.map(DspUtils.convertPowerToDb);
   const a5 = a4.map((x) => Math.max(-100, x));                                                        // clip dB values to -100. dB Values can be very low negative and that would disturb the following filter.
   const a6 = filterArray(a5, {windowFunctionId: averagingWindowFunctionId2, width: averagingWidth2}); // second filter, log values
   return a6; }

// Returns the log smoothed spectrum (spectral envelope).
function createSmoothedSpectrum (spectrum: Float64Array, scalingFactor: number, parms: GuiParms) : Float64Array {
   const width1 = Math.round(parms.analSpecWidth1 * parms.f0Reference * scalingFactor);
   const width2 = Math.round(parms.analSpecWidth2 * parms.f0Reference * scalingFactor);
   switch (parms.analSpecMethod) {
      case "smaPwrLog2":  return createSpectrumAverage_smaPwrLog2(spectrum, width1);
      case "firLpPwrLog": return createSpectrumAverage_firLpPwrLog(spectrum, width1, parms.analSpecFunc1, width2, parms.analSpecFunc2);
      default: throw new Error("Unknown analSpecMethod"); }}

function getAvgSpectrumPoints (spectrum: Float64Array, scalingFactor: number, stepWidth: number, maxFreq: number) : Point[] {
   const points: Point[] = [];
   for (let f = stepWidth; f < maxFreq; f += stepWidth) {
      const i = Math.round(f * scalingFactor);
      if (i <= 0 || i >= spectrum.length) {
         continue; }
      const y = spectrum[i];
      if (isFinite(y)) {
         points.push({x: f, y}); }}
   return points; }

export function analyzeSpectrum (signal: Float32Array, sampleRate: number, parms: GuiParms) {
   const signal2 = signal.subarray(0, Math.floor(signal.length / 2) * 2);                          // make length a multiple of 2 for speed optimization
   const windowedSignal = WindowFunctions.applyWindowById(signal2, parms.analSpecWindowFunc);
   const spectrumCompl = Fft.fftRealSpectrum(windowedSignal);                                      // complex spectrum
   const scalingFactor = windowedSignal.length / sampleRate;
   const spectrum = spectrumCompl.getAbsArray();                                                   // linear amplitudes
   const spectrumAvg = createSmoothedSpectrum(spectrum, scalingFactor, parms);                     // smoothed log amplitudes
   const spectrumCurveKnots = getAvgSpectrumPoints(spectrumAvg, scalingFactor, parms.analSpecStepWidth, parms.analSpecMaxFreq);
   const origSpecCurveFunction = (f: number) => spectrumAvg[Math.round(f * scalingFactor)];
   return {spectrumCurveKnots, origSpecCurveFunction}; }
