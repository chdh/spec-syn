// Spectral harmonic synthesizer kernel.

import {UniFunction, convertDbToAmplitudeOr0} from "./Utils.ts";

const PI2 = Math.PI * 2;

export interface SynthesizerParms {
   spectrumCurveFunctionOdd:           UniFunction;                            // function input: frequency [Hz], output: relative harmonic overtone amplitude [dB] for odd numbered harmonics
   spectrumCurveFunctionEven:          UniFunction;                            // function input: frequency [Hz], output: relative harmonic overtone amplitude [dB] for even numbered harmonics
   amplitudeCurveFunction:             UniFunction;                            // function input: time position [s], output: overall amplitude [dB]
   frequencyCurveFunction:             UniFunction;                            // function input: time position [s], output: fundamental frequency (f0) [Hz]
   duration:                           number;                                 // sound duration [s]
   sampleRate:                         number;                                 // sample rate [Hz]
   agcRmsLevel:                        number; }                               // output RMS level for automatic gain control (AGC)

export function synthesize (sp: SynthesizerParms) : Float64Array {
   const sampleCount = Math.round(sp.duration * sp.sampleRate);
   const signal = new Float64Array(sampleCount);
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
         const a = convertDbToAmplitudeOr0(spectrumCurveFunction(f));          // relative spectral amplitude of this harmonic
         analAcc += a;
         amplAcc += a * Math.sin(w * harmonic); }
      const amplitude = (analAcc > 0) ? a0 * amplAcc / analAcc : 0;            // resulting signal amplitude at current position
      signal[position] = amplitude;
      const deltaW = PI2 * f0 / sp.sampleRate;
      w += deltaW;
      if (w >= PI2) {
         w -= PI2; }}
   if (sp.agcRmsLevel > 0) {
      adjustSignalGain(signal, sp.agcRmsLevel); }
   return signal; }

function adjustSignalGain (buf: Float64Array, targetRms: number) {
   const n = buf.length;
   if (!n) {
      return; }
   const rms = computeRms(buf);
   if (!rms) {
      return; }
   let r = targetRms / rms;
   const maxAbs = findMaxAbsValue(buf);
   if (r * maxAbs >= 1) {                                                      // prevent clipping
      r = 0.99 / maxAbs; }
   for (let i = 0; i < n; i++) {
      buf[i] *= r; }}

function computeRms (buf: Float64Array) : number {
   const n = buf.length;
   let acc = 0;
   for (let i = 0; i < n; i++) {
      acc += buf[i] ** 2; }
   return Math.sqrt(acc / n); }

function findMaxAbsValue (buf: Float64Array) : number {
   const n = buf.length;
   let maxAbs = 0;
   for (let i = 0; i < n; i++) {
      maxAbs = Math.max(maxAbs, Math.abs(buf[i])); }
   return maxAbs; }

// Computes the weighted average F0 value.
export function computeAverageF0 (sp: SynthesizerParms) : number {
   const amplMin = -30;
   const amplMax = 30;
   let vAcc = 0;
   let wAcc = 0;
   for (let time = 0; time < sp.duration; time += 0.005) {
      const ampl = sp.amplitudeCurveFunction(time);                            // overall amplitude [dB] at current position
      if (!Number.isFinite(ampl) || ampl < amplMin || ampl > amplMax) {
         continue; }
      const f0 = sp.frequencyCurveFunction(time);                              // fundamental frequency at current position
      if (!Number.isFinite(f0) || f0 <= 25) {
         continue; }
      const w = ampl - amplMin;                                                // weight
      vAcc += w * f0;
      wAcc += w; }
   return vAcc / wAcc; }
