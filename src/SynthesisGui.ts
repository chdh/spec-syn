// Synthesis GUI.

import * as WavFileEncoder from "wav-file-encoder";
import * as FunctionCurveViewer from "function-curve-viewer";
import * as FunctionCurveEditor from "function-curve-editor";
import {Point} from "function-curve-editor";
import * as DspUtils from "dsp-collection/utils/DspUtils";
import * as WindowFunctions from "dsp-collection/signal/WindowFunctions";
import * as Fft from "dsp-collection/signal/Fft";
import * as ArrayUtils from "dsp-collection/utils/ArrayUtils";
import {fuzzyEquals} from "dsp-collection/math/MathUtils";
import * as DialogManager from "dialog-manager";

import * as Utils from "./Utils.ts";
import {catchError, UniFunction} from "./Utils.ts";
import * as DomUtils from "./DomUtils.ts";
import * as SpecSyn from "./SpecSyn.ts";
import * as SpecSynDist from "./SpecSynDist.ts";
import * as AppStateMgr from "./AppStateMgr.ts";
import {AppState, AppStateUpdate} from "./AppStateMgr.ts";
import * as Main from "./Main.ts";
import {audioPlayer} from "./Main.ts";

const defaultMaxDisplayFreq            = 5500;

var originalUrlParmsString             = window.location.hash.substring(1);
var activeOrigSpecCurveFunction:       UniFunction | undefined;
var originalSpecCurveVisible:          boolean = false;

// GUI components:
var spectrumEditorWidget:              FunctionCurveEditor.Widget;
var amplitudeEditorWidget:             FunctionCurveEditor.Widget;
var frequencyEditorWidget:             FunctionCurveEditor.Widget;
var wobblingEditorWidget:              FunctionCurveEditor.Widget;
var outputSignalViewerWidget:          FunctionCurveViewer.Widget;
var outputSpectrumViewerWidget:        FunctionCurveViewer.Widget;

// Output signal:
var outputSignalValid:                 boolean = false;
var outputSignal:                      Float64Array;
var outputSampleRate:                  number;

//--- Curve editors -----------------------------------------------------------

function loadSpectrumCurveEditor (knots: Point[], origSpecCurveFunction?: UniFunction) {
   activeOrigSpecCurveFunction = origSpecCurveFunction;
   const yMinMax = genSpectrumCurveYMinMax(knots);
   const editorState: Partial<FunctionCurveEditor.EditorState> = {
      knots:           knots,
      xMin:            0,
      xMax:            defaultMaxDisplayFreq,
      ...yMinMax,
      extendedDomain:  false,
      relevantXMin:    0,
      gridEnabled:     true,
      primaryZoomMode: FunctionCurveEditor.ZoomMode.x,
      xAxisUnit:       "Hz",
      yAxisUnit:       "dB",
      focusShield:     true,
      customPaintFunction: spectrumCurveEditor_customPaintFunction };
   spectrumEditorWidget.setEditorState(editorState);
   DomUtils.showElement("showOriginalSpecCurveField", !!origSpecCurveFunction); }

function loadAmplitudeCurveEditor (knots: Point[], tMax: number) {
   const yMinMax = genAmplitudeCurveYMinMax(knots);
   const editorState: Partial<FunctionCurveEditor.EditorState> = {
      knots:           knots,
      xMin:            0,
      xMax:            tMax,
      ...yMinMax,
      extendedDomain:  false,
      relevantXMin:    0,
      gridEnabled:     true,
      primaryZoomMode: FunctionCurveEditor.ZoomMode.x,
      xAxisUnit:       "s",
      yAxisUnit:       "dB",
      focusShield:     true };
   amplitudeEditorWidget.setEditorState(editorState); }

function loadFrequencyCurveEditor (knots: Point[], tMax: number) {
   const yMinMax = genFrequencyCurveYMinMax(knots);
   const editorState: Partial<FunctionCurveEditor.EditorState> = {
      knots:           knots,
      xMin:            0,
      xMax:            tMax,
      ...yMinMax,
      extendedDomain:  false,
      relevantXMin:    0,
      gridEnabled:     true,
      primaryZoomMode: FunctionCurveEditor.ZoomMode.x,
      xAxisUnit:       "s",
      yAxisUnit:       "Hz",
      focusShield:     true };
   frequencyEditorWidget.setEditorState(editorState); }

function loadWobblingCurveEditor (knots: Point[]) {
   const editorState: Partial<FunctionCurveEditor.EditorState> = {
      knots:           knots,
      xMin:            0,
      xMax:            100,
      yMin:            -90,
      yMax:            10,
      extendedDomain:  false,
      relevantXMin:    0,
      gridEnabled:     true,
      primaryZoomMode: FunctionCurveEditor.ZoomMode.x,
      xAxisUnit:       "Hz",
      yAxisUnit:       "dB\u00B2",
      focusShield:     true };
   wobblingEditorWidget.setEditorState(editorState); }

function genSpectrumCurveYMinMax (knots: Point[]) : {yMin: number; yMax: number} {
   const yVals = knots.map(knot => knot.y);
   const hi = Math.min(Math.max(...yVals), 10);
   if (!Number.isFinite(hi)) {
      return {yMin: -80, yMax: 0}; }
   const yMax = Math.ceil(hi + 5);
   const yMin = yMax - 70;
   return {yMin, yMax}; }

function genAmplitudeCurveYMinMax (knots: Point[]) : {yMin: number; yMax: number} {
   const yVals1 = knots.map(knot => knot.y);
   const yVals = yVals1.filter(y => y >= -22);
   const lo = Math.min(...yVals);
   const hi = Math.max(...yVals);
   if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      return {yMin: -25, yMax: 0}; }
   const mid = (lo + hi) / 2;
   const w1 = Math.max(hi - lo, 10);
   const w = w1 * 1.25;
   const u = 2;
   const yMin = Math.floor((mid - w / 2) / u) * u;
   const yMax = Math.ceil((mid + w / 2) / u) * u;
   return {yMin, yMax}; }

function genFrequencyCurveYMinMax (knots: Point[]) : {yMin: number; yMax: number} {
   const yValsSorted = knots.map(knot => knot.y).sort();
   const lo = ArrayUtils.getQuantileNearestFromSortedArray(yValsSorted, 0.075);
   const hi = ArrayUtils.getQuantileNearestFromSortedArray(yValsSorted, 0.98);
   if (!lo || !hi) {
      return {yMin: 0, yMax: 1000}; }
   const mid = (lo + hi) / 2;
   const w1 = Math.max(hi - lo, mid / 25);
   const w = w1 * 1.5;
   const u = 5;
   const yMin = Math.floor((mid - w / 2) / u) * u;
   const yMax = Math.ceil((mid + w / 2) / u) * u;
   return {yMin, yMax}; }

function spectrumCurveEditor_customPaintFunction (pctx: FunctionCurveEditor.CustomPaintContext) {
   paintSpectralDistribution(pctx);
   paintAdjustedSpectrumCurve(pctx);
   if (originalSpecCurveVisible && activeOrigSpecCurveFunction && pctx.pass == 1) {
      pctx.drawFunctionCurve(activeOrigSpecCurveFunction, 0, defaultMaxDisplayFreq, "#C86FEB"); }}

function paintAdjustedSpectrumCurve (pctx: FunctionCurveEditor.CustomPaintContext) {
   if (pctx.pass != 1) {
      return; }
   if (!isSpectrumAdjustmentActive()) {
      return; }
   const spectrumCurveFunctionAdj = getAdjustedSpectrumCurveFunction();
   pctx.drawFunctionCurve(spectrumCurveFunctionAdj, 0, defaultMaxDisplayFreq, "#37ADFA"); }

function showOriginalSpecCurve_change() {
   originalSpecCurveVisible = DomUtils.getChecked("showOriginalSpecCurve");
   refreshSpectrumEditor(); }

//--- Curve viewer ------------------------------------------------------------

function loadSignalViewer (widget: FunctionCurveViewer.Widget, signal: ArrayLike<number>, sampleRate: number) {
   const viewerFunction = FunctionCurveViewer.createViewerFunctionForArray(signal, {scalingFactor: sampleRate});
   const yRange = 1.2;
   const viewerState : Partial<FunctionCurveViewer.ViewerState> = {
      viewerFunction:  viewerFunction,
      xMin:            0,
      xMax:            signal.length / sampleRate,
      yMin:            -yRange,
      yMax:            yRange,
      gridEnabled:     true,
      primaryZoomMode: FunctionCurveViewer.ZoomMode.x,
      xAxisUnit:       "s",
      focusShield:     true };
   widget.setViewerState(viewerState); }

function loadSpectrumViewer (widget: FunctionCurveViewer.Widget, spectrumLog: Float64Array, scalingFactor: number) {
   const viewerFunction = FunctionCurveViewer.createViewerFunctionForArray(spectrumLog, {scalingFactor, nearestNeighbor: true});
   const viewerState : Partial<FunctionCurveViewer.ViewerState> = {
      viewerFunction:   viewerFunction,
      xMin:             0,
      xMax:             defaultMaxDisplayFreq,
      yMin:             -100,
      yMax:             0,
      gridEnabled:      true,
      primaryZoomMode:  FunctionCurveViewer.ZoomMode.x,
      xAxisUnit:        "Hz",
      yAxisUnit:        "dB",
      focusShield:      true };
   widget.setViewerState(viewerState); }

//--- App state ---------------------------------------------------------------

function getAppStateFromUi() : AppState {
   const appState = <AppState>{};
   appState.sampleRate         = DomUtils.getValueNum("sampleRate");
   appState.agcRmsLevel        = DomUtils.getValueNum("agcRmsLevel");
   appState.transformationMode = DomUtils.getValue("transformationMode");
   appState.f0Multiplier       = DomUtils.getValueNum("f0Multiplier");
   appState.specMultiplier     = DomUtils.getValueNum("specMultiplier");
   appState.specShift          = DomUtils.getValueNum("specShift");
   appState.evenAmplShift      = DomUtils.getValueNum("evenAmplShift");
   appState.f0New              = DomUtils.getValueNum("f0New");
   appState.fLoBand            = DomUtils.getValueNum("fLoBand");
   appState.fHiBand            = DomUtils.getValueNum("fHiBand");
   appState.wobblingEnabled    = DomUtils.getChecked("wobblingEnabled");
   appState.reference          = DomUtils.getValue("reference");
   appState.spectrumCurveKnots  = spectrumEditorWidget.getEditorState().knots;
   appState.amplitudeCurveKnots = amplitudeEditorWidget.getEditorState().knots;
   appState.frequencyCurveKnots = frequencyEditorWidget.getEditorState().knots;
   appState.wobblingCurveKnots  = wobblingEditorWidget.getEditorState().knots;
   return appState; }

function getLastKnotX (knots: Point[]) : number | undefined {
   return knots.length ? knots[knots.length - 1].x : undefined; }

function genTMax (knots: Point[]) : number {
   const defaultTMax = 3;                                                      // 3 seconds
   const t = getLastKnotX(knots) ?? defaultTMax;
   return Math.round((t + 0.099) / 0.1) * 0.1; }

function setAppStateToUi (appState: AppState) {
   DomUtils.setValueNum("sampleRate",         appState.sampleRate);
   DomUtils.setValueNum("agcRmsLevel",        appState.agcRmsLevel);
   DomUtils.setValueNum("f0Multiplier",       appState.f0Multiplier);
   DomUtils.setValue(   "transformationMode", appState.transformationMode);
   DomUtils.setValueNum("specMultiplier",     appState.specMultiplier);
   DomUtils.setValueNum("specShift",          appState.specShift);
   DomUtils.setValueNum("evenAmplShift",      appState.evenAmplShift);
   DomUtils.setValueNum("f0New",              appState.f0New);
   DomUtils.setValueNum("fLoBand",            appState.fLoBand);
   DomUtils.setValueNum("fHiBand",            appState.fHiBand);
   DomUtils.setChecked( "wobblingEnabled",    appState.wobblingEnabled);
   DomUtils.setValue(   "reference",          appState.reference);
   const tMax = Math.max(genTMax(appState.amplitudeCurveKnots), genTMax(appState.frequencyCurveKnots));
   loadSpectrumCurveEditor(appState.spectrumCurveKnots);
   loadAmplitudeCurveEditor(appState.amplitudeCurveKnots, tMax);
   loadFrequencyCurveEditor(appState.frequencyCurveKnots, tMax);
   loadWobblingCurveEditor(appState.wobblingCurveKnots);
   refreshSpecDistIfVisible();
   refreshMainGui(); }

function loadUiAppStateFromUrl (suppressCurves = false) {
   const urlParmsString = window.location.hash.substring(1);
   const appState = AppStateMgr.decodeAppStateUrlParms(urlParmsString);
   if (suppressCurves) {
      appState.spectrumCurveKnots = [];
      appState.amplitudeCurveKnots = [];
      appState.frequencyCurveKnots = []; }
   setAppStateToUi(appState); }

function saveUiAppStateToUrl() {
   const appState = getAppStateFromUi();
   const urlParmsString = AppStateMgr.encodeAppStateUrlParms(appState);
   if (urlParmsString == window.location.hash.substring(1)) {
      return; }
   if (Main.startupCompleted) {
      window.history.pushState(null, "", "#" + urlParmsString); }
    else {
      window.history.replaceState(null, "", "#" + urlParmsString); }}

function resetButton_click() {
   const appState = AppStateMgr.decodeAppStateUrlParms(originalUrlParmsString);
   setAppStateToUi(appState); }

export function updateAppStateFromAnalysis (appState: AppStateUpdate) {
   const amplKnots = appState.amplitudeCurveKnots ?? amplitudeEditorWidget.getEditorState().knots;
   const freqKnots = appState.frequencyCurveKnots ?? frequencyEditorWidget.getEditorState().knots;
   const tMax = Math.max(genTMax(amplKnots), genTMax(freqKnots));
   if (appState.spectrumCurveKnots) {
      loadSpectrumCurveEditor(appState.spectrumCurveKnots, appState.origSpecCurveFunction); }
   if (appState.amplitudeCurveKnots) {
      loadAmplitudeCurveEditor(appState.amplitudeCurveKnots, tMax); }
   if (appState.frequencyCurveKnots) {
      loadFrequencyCurveEditor(appState.frequencyCurveKnots, tMax); }
   if (appState.wobblingCurveKnots) {
      loadWobblingCurveEditor(appState.wobblingCurveKnots); }
   refreshSpecDistIfVisible(); }

//--- Spectral distribution ---------------------------------------------------

const enum SpecDistPaintMode {none, background, bars, line}
var specDistData:                      Float64Array;                           // spectral distribution for histogram or curve in GUI as user info to indicate significant frequencies

function isSpecDistVisible() : boolean {
   return DomUtils.getValueNum("specDistPaintMode") > 0; }

function updateSpectralDistribution() {
   const dp = <SpecSynDist.DistribParms>{};
   dp.amplitudeCurveFunction = amplitudeEditorWidget.getFunction();
   dp.frequencyCurveFunction = getAdjustedFrequencyCurveFunction();
   dp.evenAmplShift = DomUtils.getValueNum("evenAmplShift");
   dp.duration = getDuration();
   dp.distribMaxFreq = defaultMaxDisplayFreq;
   dp.distribRes = 500;
   dp.stepWidth = 0.005;
   specDistData = SpecSynDist.computeDistrib(dp); }

function paintSpectralDistribution (pctx: FunctionCurveEditor.CustomPaintContext) {
   if (pctx.pass != 1 || !specDistData) {
      return; }
   const paintMode: SpecDistPaintMode = DomUtils.getValueNum("specDistPaintMode");
   if (!paintMode) {
      return; }
   const ctx = pctx.ctx;
   ctx.save();
   let penDown = false;
   switch (paintMode) {
      case SpecDistPaintMode.bars: {
         ctx.fillStyle = "#DBF1FF";
         break; }
      case SpecDistPaintMode.line: {
         ctx.beginPath();
         break; }}
   const lyTop = -5;                                                           // top y for bars and lines
   const lyBottom = -40;                                                       // bottom y for bars and lines
   const cyBottom = pctx.mapLogicalToCanvasYCoordinate(lyBottom);
   const distribRes = specDistData.length;
   for (let i = 0; i < distribRes; i++) {
      const v = specDistData[i];
      const lx1 = defaultMaxDisplayFreq / distribRes * i;
      const lx2 = defaultMaxDisplayFreq / distribRes * (i + 1);
      const cx1 = pctx.mapLogicalToCanvasXCoordinate(lx1);
      const cx2 = pctx.mapLogicalToCanvasXCoordinate(lx2);
      switch (paintMode) {
         case SpecDistPaintMode.background: {
            if (!isFinite(v)) {
               continue; }
            const cutOffDb = 30;
            const satExt = 15;
            const sat = Math.round(Math.max(0, 100 - (v + cutOffDb) / cutOffDb * satExt));
            if (sat >= 100) {
               continue; }
            ctx.fillStyle = "hsl(204, 100%, " + sat + "%)";
            ctx.fillRect(cx1, 0, cx2 - cx1, ctx.canvas.height);
            break; }
         case SpecDistPaintMode.bars: {
            const cy = pctx.mapLogicalToCanvasYCoordinate(lyTop + v);
            if (!isFinite(v) || cy >= cyBottom) {
               continue; }
            ctx.fillRect(cx1, cy, cx2 - cx1, cyBottom - cy);
            break; }
         case SpecDistPaintMode.line: {
            const cy = pctx.mapLogicalToCanvasYCoordinate(lyTop + v);
            if (!isFinite(v) || v < -200 || cy >= cyBottom) {
               if (penDown) {
                  ctx.lineTo(cx1, cyBottom);
                  penDown = false; }
               continue; }
            if (!penDown) {
               ctx.moveTo(cx1, cyBottom);
               penDown = true; }
            ctx.lineTo(cx1, cy);
            ctx.lineTo(cx2, cy);
            break; }}}
   switch (paintMode) {
      case SpecDistPaintMode.line: {
         ctx.strokeStyle = "#37A0E6";
         ctx.stroke();
         break; }}
   ctx.restore(); }

function refreshSpecDist() {
   if (isSpecDistVisible()) {
      updateSpectralDistribution(); }
   refreshSpectrumEditor(); }

function refreshSpecDistIfVisible() {
   if (isSpecDistVisible()) {
      refreshSpecDist(); }}

//--- Main functions ----------------------------------------------------------

function refreshSpectrumEditor() {
   spectrumEditorWidget.requestRefresh(); }

function getDuration() : number {
   const ampliduteEditorState = amplitudeEditorWidget.getEditorState();
   const frequencyEditorState = frequencyEditorWidget.getEditorState();
   return Math.min(getLastKnotX(ampliduteEditorState.knots) ?? 1, getLastKnotX(frequencyEditorState.knots) ?? 1); }

function calcF0Orig() : number {
   const amplitudeCurveFunction = amplitudeEditorWidget.getFunction();
   const frequencyCurveFunction = frequencyEditorWidget.getFunction();
   const duration = getDuration();
   return SpecSyn.computeAverageF0(amplitudeCurveFunction, frequencyCurveFunction, duration); }

function getAdjustedFrequencyCurveFunction() : UniFunction {
   const transformationMode = DomUtils.getValue("transformationMode");
   let f0Multiplier = 1;
   switch (transformationMode) {
      case "basic": case "transposeRel": {
         f0Multiplier = DomUtils.getValueNum("f0Multiplier");
         break; }
      case "transposeAbs": {
         const f0New = DomUtils.getValueNum("f0New");
         const f0Orig = calcF0Orig();
         f0Multiplier = f0New / f0Orig;
         break; }}
   const frequencyCurveFunction = frequencyEditorWidget.getFunction();
   if (fuzzyEquals(f0Multiplier, 1, 1E-5)) {
      return frequencyCurveFunction; }
   return (t: number) => frequencyCurveFunction(t) * f0Multiplier; }

function transposeVowelSpectrumCurve (spectrumCurveFunction: UniFunction, f0Delta: number) : UniFunction {
   const fLoBand = DomUtils.getValueNum("fLoBand");        // end of lower band
   const fHiBand = DomUtils.getValueNum("fHiBand");        // start of upper band
   const w = fHiBand  - fLoBand;                           // width of stretch band
   const w2 = w + Math.abs(f0Delta);                       // extended width = width after expansion = width before compression
   const fLoBand2 = fLoBand - Math.abs(f0Delta);           // end of reduced lower band
   const fLoBand3 = (f0Delta > 0) ? fLoBand : fLoBand2;    // edge frequency for transformed frequency
   return (fTrans: number) => {                            // new spectrum function curve for transformed spectrum
      let fOrig: number;
      // `fTrans` is the frequency in the transformed spectrum.
      // `fOrig` is the frequency in the original spectrum.
      // The transformation logic here is inverse, because we have to map `fTrans` to `fOrig`.
      if (fTrans < fLoBand3) {                             // f is in the lower band (or reduced lower band for down transposition)
         fOrig = fTrans - f0Delta; }                       // shift spectrum by delta F0 in lower band
       else if (fTrans < fHiBand) {                        // f is within the stretch band between lower and upper bands
         if (f0Delta > 0) {                                // transpose upwards -> compress spectrum -> inverse expansion
            const p = (fTrans - fLoBand) / w;              // linear position for compression
            fOrig = fLoBand2 + w2 * p; }                   // linear compression of [fLoBand - f0Delta .. fHiBand] to [fLoBand .. fHiBand]
          else {                                           // transpose downwards -> expand spectrum -> inverse compression
            const p = (fTrans - fLoBand2) / w2;            // linear position for expansion
            fOrig = fLoBand + w * p; }}                    // linear expansion of [fLoBand .. fHiBand] to [fLoBand - abs(f0Delta) .. fHiBand]
       else {                                              // f is in the upper band
         fOrig = fTrans; }                                 // no transformation in upper band
      return spectrumCurveFunction(fOrig); }; }

function adjustSpectrumCurveFunction (spectrumCurveFunction: UniFunction) : UniFunction {
   const transformationMode = DomUtils.getValue("transformationMode");
   switch (transformationMode) {
      case "basic": {
         const specMultiplier = DomUtils.getValueNum("specMultiplier");
         const specShift = DomUtils.getValueNum("specShift");
         if (specMultiplier == 1 && specShift == 0) {
            return spectrumCurveFunction; }
         return (f: number) => spectrumCurveFunction(f / specMultiplier - specShift); }
      case "transposeRel": case "transposeAbs": {
         const f0Orig = calcF0Orig();
         let f0New: number;
         if (transformationMode == "transposeRel") {
            const f0Multiplier = DomUtils.getValueNum("f0Multiplier");
            f0New = f0Orig * f0Multiplier; }
          else {
            f0New = DomUtils.getValueNum("f0New"); }
         const f0Delta = f0New - f0Orig;
         if (Math.abs(f0Delta) < 0.1) {
            return spectrumCurveFunction; }
         return transposeVowelSpectrumCurve(spectrumCurveFunction, f0Delta); }
      default: {
         return spectrumCurveFunction; }}}

function getAdjustedSpectrumCurveFunction() : UniFunction {
   return adjustSpectrumCurveFunction(spectrumEditorWidget.getFunction()); };

function isSpectrumAdjustmentActive() : boolean {
   const dummy = (_f: number) => 0;
   return adjustSpectrumCurveFunction(dummy) != dummy; }

function genOutputSpectrum() {
   const signal = outputSignal.subarray(0, Math.floor(outputSignal.length / 2) * 2);     // make length even for speed optimization
   const windowFunctionId = DomUtils.getValue("outSpecWindowFunction");
   const windowedSignal = (windowFunctionId == "rect") ? signal : WindowFunctions.applyWindowById(signal, windowFunctionId);
   const spectrum = Fft.fftRealSpectrum(windowedSignal);
   const spectrumAmplitudes = spectrum.getAbsArray();
   const spectrumLog = spectrumAmplitudes.map(DspUtils.convertAmplitudeToDb);
   loadSpectrumViewer(outputSpectrumViewerWidget, spectrumLog, signal.length / outputSampleRate); }

export function synthesize() {
   const sampleRate      = DomUtils.getValueNum("sampleRate");
   const agcRmsLevel     = DomUtils.getValueNum("agcRmsLevel");
   const evenAmplShift   = DomUtils.getValueNum("evenAmplShift");
   const wobblingEnabled = DomUtils.getChecked("wobblingEnabled");

   const duration = getDuration();

   const amplitudeCurveFunction = amplitudeEditorWidget.getFunction();
   const wobblingCurveFunction  = wobblingEnabled ? wobblingEditorWidget.getFunction() : undefined;
   const frequencyCurveFunction = getAdjustedFrequencyCurveFunction();

   const sp = <SpecSyn.SynthesizerParms>{};
   sp.sampleRate = sampleRate;
   sp.agcRmsLevel = agcRmsLevel;
   sp.duration = duration;
   const spectrumCurveFunctionAdj = getAdjustedSpectrumCurveFunction();
   sp.spectrumCurveFunctionOdd = spectrumCurveFunctionAdj;
   sp.spectrumCurveFunctionEven = (evenAmplShift == 0) ? spectrumCurveFunctionAdj : (f: number) => spectrumCurveFunctionAdj(f) + evenAmplShift;
   sp.amplitudeCurveFunction = amplitudeCurveFunction;
   sp.frequencyCurveFunction = frequencyCurveFunction;
   sp.wobblingCurveFunction = wobblingCurveFunction;
   outputSignal = SpecSyn.synthesize(sp);

   const averageF0 = SpecSyn.computeAverageF0(amplitudeCurveFunction, frequencyCurveFunction, duration);
   outputSampleRate = sampleRate;
   outputSignalValid = true;
   loadSignalViewer(outputSignalViewerWidget, outputSignal, outputSampleRate);
   genOutputSpectrum();
   DomUtils.setText("outputSignalInfo", "Average F0 [Hz]: " + Math.round(averageF0));

   refreshMainGui();
   saveUiAppStateToUrl(); }

async function synthesizeButton_click() {
   try {
      if (DomUtils.getChecked("wobblingEnabled")) {
         await Utils.showProgressInfo(); }
      audioPlayer.stop();
      synthesize(); }
    finally {
      DialogManager.closeProgressInfo(); }}

async function synthesizeAndPlayButton_click() {
   if (audioPlayer.isPlaying()) {
      audioPlayer.stop();
      return; }
   await synthesizeButton_click();
   await playOutputSignal(); }

export async function playOutputSignal() {
   await audioPlayer.playSamples(outputSignal, outputSampleRate); }

async function playOutputButton_click() {
   if (audioPlayer.isPlaying()) {
      audioPlayer.stop();
      return; }
   await playOutputSignal(); }

function saveOutputWavFileButton_click() {
   audioPlayer.stop();
   const wavFileData = WavFileEncoder.encodeWavFile2([outputSignal], outputSampleRate, WavFileEncoder.WavFileType.float32);
   const fileName = "specSynOutput.wav";
   Utils.openSaveAsDialog(wavFileData, fileName, "audio/wav", "wav", "WAV audio file"); }

function refreshMainGui() {
   outputSignalViewerWidget.disabled = !outputSignalValid;
   const wobblingEnabled = DomUtils.getChecked("wobblingEnabled");
   const transformationMode = DomUtils.getValue("transformationMode");
   DomUtils.setText("synthesizeAndPlayButton", audioPlayer.isPlaying() ? "Stop" : "Synth + Play");
   DomUtils.enableElement("playOutputButton", outputSignalValid);
   DomUtils.setText("playOutputButton", audioPlayer.isPlaying() ? "Stop" : "Play");
   DomUtils.enableElement("saveOutputWavFileButton", outputSignalValid);
   DomUtils.showElement("wobblingSection", wobblingEnabled);
   DomUtils.showElement("f0MultiplierField", transformationMode == "basic" || transformationMode == "transposeRel");
   DomUtils.showElement("specMultiplierField", transformationMode == "basic");
   DomUtils.showElement("specShiftField", transformationMode == "basic");
   DomUtils.showElement("evenAmplShiftField", transformationMode == "basic");
   DomUtils.showElement("f0NewField", transformationMode == "transposeAbs");
   DomUtils.showElement("fLoBandField", transformationMode == "transposeRel" || transformationMode == "transposeAbs");
   DomUtils.showElement("fHiBandField", transformationMode == "transposeRel" || transformationMode == "transposeAbs"); }

function functionCurveEditorHelpButton_click() {
   const t = document.getElementById("functionCurveEditorHelpText")!;
   t.innerHTML = spectrumEditorWidget.getFormattedHelpText();
   t.classList.toggle("hidden"); }

function functionCurveViewerHelpButton2_click() {
   const t = document.getElementById("functionCurveViewerHelpText2")!;
   t.innerHTML = outputSignalViewerWidget.getFormattedHelpText();
   t.classList.toggle("hidden"); }

function populateWindowFunctionSelect (elementId: string, defaultWindowFunctionId: string) {
   const selectElement = <HTMLSelectElement>document.getElementById(elementId)!;
   for (const d of WindowFunctions.windowFunctionIndex) {
      const selected = d.id == defaultWindowFunctionId;
      selectElement.add(new Option(d.name, d.id, selected, selected)); }}

export function startup (suppressDefaultCurves: boolean) {
   loadUiAppStateFromUrl(suppressDefaultCurves);
   refreshMainGui(); }

export function init() {
   audioPlayer.addEventListener("stateChange", refreshMainGui);
   const spectrumEditorCanvas       = <HTMLCanvasElement>document.getElementById("spectrumEditorCanvas")!;
   const amplitudeEditorCanvas      = <HTMLCanvasElement>document.getElementById("amplitudeEditorCanvas")!;
   const frequencyEditorCanvas      = <HTMLCanvasElement>document.getElementById("frequencyEditorCanvas")!;
   const wobblingEditorCanvas       = <HTMLCanvasElement>document.getElementById("wobblingEditorCanvas")!;
   const outputSignalViewerCanvas   = <HTMLCanvasElement>document.getElementById("outputSignalViewerCanvas")!;
   const outputSpectrumViewerCanvas = <HTMLCanvasElement>document.getElementById("outputSpectrumViewerCanvas")!;
   spectrumEditorWidget       = new FunctionCurveEditor.Widget(spectrumEditorCanvas);
   amplitudeEditorWidget      = new FunctionCurveEditor.Widget(amplitudeEditorCanvas);
   frequencyEditorWidget      = new FunctionCurveEditor.Widget(frequencyEditorCanvas);
   wobblingEditorWidget       = new FunctionCurveEditor.Widget(wobblingEditorCanvas);
   outputSignalViewerWidget   = new FunctionCurveViewer.Widget(outputSignalViewerCanvas);
   outputSpectrumViewerWidget = new FunctionCurveViewer.Widget(outputSpectrumViewerCanvas);
   populateWindowFunctionSelect("outSpecWindowFunction", "hann");
   //
   DomUtils.addClickEventListener("synthesizeButton", synthesizeButton_click);
   DomUtils.addClickEventListener("synthesizeAndPlayButton", synthesizeAndPlayButton_click);
   DomUtils.addClickEventListener("resetButton", resetButton_click);
   DomUtils.addClickEventListener("playOutputButton", playOutputButton_click);
   DomUtils.addClickEventListener("saveOutputWavFileButton", saveOutputWavFileButton_click);
   DomUtils.addClickEventListener("functionCurveEditorHelpButton", functionCurveEditorHelpButton_click);
   DomUtils.addClickEventListener("functionCurveViewerHelpButton2", functionCurveViewerHelpButton2_click);
   //
   DomUtils.addChangeEventListener("specDistPaintMode", refreshSpecDist);
   DomUtils.addChangeEventListener("showOriginalSpecCurve", showOriginalSpecCurve_change);
   DomUtils.addChangeEventListener("transformationMode", refreshMainGui);
   DomUtils.addChangeEventListener("transformationMode", refreshSpectrumEditor);
   DomUtils.addChangeEventListener("f0Multiplier", refreshSpecDistIfVisible);
   DomUtils.addChangeEventListener("f0Multiplier", refreshSpectrumEditor);               // (only for mode transposeRel relevant, not in basic mode)
   DomUtils.addChangeEventListener("evenAmplShift", refreshSpecDistIfVisible);
   DomUtils.addChangeEventListener("specMultiplier", refreshSpectrumEditor);
   DomUtils.addChangeEventListener("f0New", refreshSpectrumEditor);
   DomUtils.addChangeEventListener("fLoBand", refreshSpectrumEditor);
   DomUtils.addChangeEventListener("fHiBand", refreshSpectrumEditor);
   DomUtils.addChangeEventListener("specShift", refreshSpectrumEditor);
   DomUtils.addChangeEventListener("wobblingEnabled", refreshMainGui);
   amplitudeEditorWidget.addEventListener("change", refreshSpecDistIfVisible);
   frequencyEditorWidget.addEventListener("change", refreshSpecDistIfVisible);
   //
   window.onpopstate = () => catchError(loadUiAppStateFromUrl);
   refreshMainGui(); }
