// Spectral harmonic synthesizer kernel.

import * as DspUtils from "dsp-collection/utils/DspUtils";
import * as MathUtils from "dsp-collection/math/MathUtils";
import * as NoiseGen from "dsp-collection/signal/NoiseGen";
import {UniFunction, convertDbToAmplitudeOr0} from "./Utils.ts";

const PI2 = Math.PI * 2;

export interface SynthesizerParms {
   spectrumCurveFunctionOdd:           UniFunction;                            // function input: frequency [Hz], output: relative harmonic overtone amplitude [dB] for odd numbered harmonics
   spectrumCurveFunctionEven:          UniFunction;                            // function input: frequency [Hz], output: relative harmonic overtone amplitude [dB] for even numbered harmonics
   amplitudeCurveFunction:             UniFunction;                            // function input: time position [s], output: overall amplitude [dB]
   frequencyCurveFunction:             UniFunction;                            // function input: time position [s], output: fundamental frequency (f0) [Hz]
   wobblingCurveFunction:              UniFunction | undefined;                // function input: noise frequency [Hz], output: noise amplitude [dB]
   duration:                           number;                                 // sound duration [s]
   sampleRate:                         number;                                 // sample rate [Hz]
   agcRmsLevel:                        number; }                               // output RMS level for automatic gain control (AGC) or 0

export function synthesize (sp: SynthesizerParms) : Float64Array {
   const startTime = performance.now();
   const sampleCount = Math.round(sp.duration * sp.sampleRate);
   const signal = new Float64Array(sampleCount);
   const wobbler = sp.wobblingCurveFunction ? new Wobbler(sp.wobblingCurveFunction, sampleCount, sp.sampleRate) : undefined;
   let w = 0;                                                                  // angle of fundamental wave
   for (let position = 0; position < sampleCount; position++) {                // loop over sample positions
      const time = position / sp.sampleRate;                                   // time [s] of current position
      const a0Db = sp.amplitudeCurveFunction(time);                            // overall amplitude [dB] at current position
      const a0 = convertDbToAmplitudeOr0(a0Db);                                // overall amplitude [linear] at current position
      const f0 = sp.frequencyCurveFunction(time);                              // fundamental frequency at current position
      if (!Number.isFinite(f0) || f0 <= 25) {
         continue; }
      const harmonics = Math.floor((sp.sampleRate / 2 - 1000) / f0);
      let amplAcc = 0;                                                         // signal amplitude accumulator
      let analAcc = 0;                                                         // accumulator for analytic signal amplitudes, used for power normalization
      for (let harmonic = 1; harmonic <= harmonics; harmonic++) {
         const f = f0 * harmonic;                                              // frequency of this harmonic
         const harmonicIsEven = (harmonic % 2) == 0;
         const spectrumCurveFunction = harmonicIsEven ? sp.spectrumCurveFunctionEven : sp.spectrumCurveFunctionOdd;
         let logAmp = spectrumCurveFunction(f);                                // relative spectral amplitude of this harmonic
         if (wobbler && logAmp > -100) {
            logAmp += wobbler.getLogAmplitudeDelta(position, harmonic); }
         const a = convertDbToAmplitudeOr0(logAmp);
         analAcc += a;
         amplAcc += a * Math.sin(w * harmonic); }
      const amplitude = (analAcc > 0) ? a0 * amplAcc / analAcc : 0;            // resulting signal amplitude at current position
      signal[position] = amplitude;
      const deltaW = PI2 * f0 / sp.sampleRate;
      w += deltaW;
      if (w >= PI2) {
         w -= PI2; }}
   if (sp.agcRmsLevel > 0) {
      DspUtils.adjustSignalLevel(signal, {targetRms: sp.agcRmsLevel, targetMaxLevel: 0.99}); }
   const durationMs = Math.round(performance.now() - startTime);
   console.log(`Synthesis duration: ${durationMs} ms.`);
   return signal; }

// Computes the weighted average F0 value.
export function computeAverageF0 (amplitudeCurveFunction: UniFunction, frequencyCurveFunction: UniFunction, duration: number) : number {
   const amplMin = -30;
   const amplMax = 30;
   let vAcc = 0;
   let wAcc = 0;
   for (let time = 0; time < duration; time += 0.005) {
      const ampl = amplitudeCurveFunction(time);                               // overall amplitude [dB] at current position
      if (!Number.isFinite(ampl) || ampl < amplMin || ampl > amplMax) {
         continue; }
      const f0 = frequencyCurveFunction(time);                                 // fundamental frequency at current position
      if (!Number.isFinite(f0) || f0 <= 25) {
         continue; }
      const w = ampl - amplMin;                                                // weight
      vAcc += w * f0;
      wAcc += w; }
   return vAcc / wAcc; }

function mapDbToAmplitudeOr0Function (f: UniFunction) : UniFunction {
   return (x: number) => convertDbToAmplitudeOr0(f(x)); }

class Wobbler {

   private noiseSpecAmplitudes:        Float64Array;                           // common noise amplitudes for all harmonics
   private noise:                      Float64Array[];                         // each harmonic has it's separate noise signal
   private n:                          number;

   public constructor (wobblingCurveFunction: UniFunction, sampleCount: number, sampleRate: number) {
      this.noise = new Array(200);                                             // pre-allocate array that will grow dynamically
      const wobblingCurveFunctionLin = mapDbToAmplitudeOr0Function(wobblingCurveFunction);
      const n = MathUtils.getNextPowerOf2(sampleCount);
      const n2 = Math.floor(n / 2);
      this.noiseSpecAmplitudes = Float64Array.from({length: n2}, (_x, i) => wobblingCurveFunctionLin(i * sampleRate / n));
      this.noiseSpecAmplitudes[0] = 0;                                         // ensure that the DC value is 0
      this.n = n; }

   public getLogAmplitudeDelta (position: number, harmonic: number) : number {
      if (!this.noise[harmonic]) {
         this.noise[harmonic] = this.generateNoise(); }
      return this.noise[harmonic][position]; }

   private generateNoise() : Float64Array {
      return NoiseGen.generateSpectralNoise(this.noiseSpecAmplitudes, this.n); }

   }
