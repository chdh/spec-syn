// Fundamental frequency curve analysis for SpecSyn.

import {Point} from "function-curve-editor";
import * as HarmAnal from "harm-syn/analysis/HarmAnal";

export interface GuiParms {                                // GUI parameters
   f0Reference:              number;                       // reference value for the fundamental frequency
   analFreqStepWidth:        number; }                     // step width [s] for generating the knots for the editable frequency function curve

export function analyzeFrequencyCurve (signal: Float32Array, sampleRate: number, parms: GuiParms) : Point[] {
   const analParms: HarmAnal.AnalParmsPass1 = {
      ...HarmAnal.defaultAnalParmsPass1,
      startFrequency:        parms.f0Reference,
      trackingInterval:      0.001 };                      // 1ms (this is already the default, but that could change)
   const f0ExtractionInterval = Math.round(parms.analFreqStepWidth / analParms.trackingInterval);
   const f0Trace = HarmAnal.getF0Trace(signal, sampleRate, analParms, f0ExtractionInterval);
   const w = f0ExtractionInterval * analParms.trackingInterval;
   const knots = Array.from(f0Trace, (f0, i) => ({x: i * w, y: f0}));
   return knots; }
