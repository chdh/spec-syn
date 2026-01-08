// Synthesis GUI.

import * as WavFileEncoder from "wav-file-encoder";
import * as FunctionCurveViewer from "function-curve-viewer";
import * as FunctionCurveEditor from "function-curve-editor";
import {Point} from "function-curve-editor";
import * as DspUtils from "dsp-collection/utils/DspUtils";
import * as WindowFunctions from "dsp-collection/signal/WindowFunctions";
import * as Fft from "dsp-collection/signal/Fft";

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
var outputSignalViewerWidget:          FunctionCurveViewer.Widget;
var outputSpectrumViewerWidget:        FunctionCurveViewer.Widget;

// Output signal:
var outputSignalValid:                 boolean = false;
var outputSignal:                      Float64Array;
var outputSampleRate:                  number;

//--- Curve editors -----------------------------------------------------------

function loadSpectrumCurveEditor (knots: Point[], origSpecCurveFunction?: UniFunction) {
   activeOrigSpecCurveFunction = origSpecCurveFunction;
   const editorState: Partial<FunctionCurveEditor.EditorState> = {
      knots:           knots,
      xMin:            0,
      xMax:            defaultMaxDisplayFreq,
      yMin:            -100,
      yMax:            0,
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
   const editorState: Partial<FunctionCurveEditor.EditorState> = {
      knots:           knots,
      xMin:            0,
      xMax:            tMax,
      yMin:            -70,
      yMax:            0,
      extendedDomain:  false,
      relevantXMin:    0,
      gridEnabled:     true,
      primaryZoomMode: FunctionCurveEditor.ZoomMode.x,
      xAxisUnit:       "s",
      yAxisUnit:       "dB",
      focusShield:     true };
   amplitudeEditorWidget.setEditorState(editorState); }

function loadFrequencyCurveEditor (knots: Point[], tMax: number) {
   const editorState: Partial<FunctionCurveEditor.EditorState> = {
      knots:           knots,
      xMin:            0,
      xMax:            tMax,
      yMin:            0,
      yMax:            1000,
      extendedDomain:  false,
      relevantXMin:    0,
      gridEnabled:     true,
      primaryZoomMode: FunctionCurveEditor.ZoomMode.x,
      xAxisUnit:       "s",
      yAxisUnit:       "Hz",
      focusShield:     true };
   frequencyEditorWidget.setEditorState(editorState); }

function spectrumCurveEditor_customPaintFunction (pctx: FunctionCurveEditor.CustomPaintContext) {
   paintSpectralDistribution(pctx);
   paintAdjustedSpectrumCurve(pctx);
   if (originalSpecCurveVisible && activeOrigSpecCurveFunction && pctx.pass == 1) {
      pctx.drawFunctionCurve(activeOrigSpecCurveFunction, 0, defaultMaxDisplayFreq, "#C86FEB"); }}

function paintAdjustedSpectrumCurve (pctx: FunctionCurveEditor.CustomPaintContext) {
   if (pctx.pass != 1) {
      return; }
   const specMultiplier = DomUtils.getValueNum("specMultiplier");
   const specShift = DomUtils.getValueNum("specShift");
   if (specMultiplier == 1 && specShift == 0) {
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

function getAppStateFromUi() {
   const appState = <AppState>{};
   appState.sampleRate     = DomUtils.getValueNum("sampleRate");
   appState.agcRmsLevel    = DomUtils.getValueNum("agcRmsLevel");
   appState.f0Multiplier   = DomUtils.getValueNum("f0Multiplier");
   appState.specMultiplier = DomUtils.getValueNum("specMultiplier");
   appState.specShift      = DomUtils.getValueNum("specShift");
   appState.evenAmplShift  = DomUtils.getValueNum("evenAmplShift");
   appState.spectrumCurveKnots = spectrumEditorWidget.getEditorState().knots;
   appState.amplitudeCurveKnots = amplitudeEditorWidget.getEditorState().knots;
   appState.frequencyCurveKnots = frequencyEditorWidget.getEditorState().knots;
   appState.reference = DomUtils.getValue("reference");
   return appState; }

function getLastKnotX (knots: Point[]) : number | undefined {
   return knots.length ? knots[knots.length - 1].x : undefined; }

function genTMax (knots: Point[]) : number {
   const defaultTMax = 3;                                                      // 3 seconds
   const t = getLastKnotX(knots) ?? defaultTMax;
   return Math.round((t + 0.099) / 0.1) * 0.1; }

function setAppStateToUi (appState: AppState) {
   DomUtils.setValueNum("sampleRate",     appState.sampleRate);
   DomUtils.setValueNum("agcRmsLevel",    appState.agcRmsLevel);
   DomUtils.setValueNum("f0Multiplier",   appState.f0Multiplier);
   DomUtils.setValueNum("specMultiplier", appState.specMultiplier);
   DomUtils.setValueNum("specShift",      appState.specShift);
   DomUtils.setValueNum("evenAmplShift",  appState.evenAmplShift);
   const tMax = Math.max(genTMax(appState.amplitudeCurveKnots), genTMax(appState.frequencyCurveKnots));
   loadSpectrumCurveEditor(appState.spectrumCurveKnots);
   loadAmplitudeCurveEditor(appState.amplitudeCurveKnots, tMax);
   loadFrequencyCurveEditor(appState.frequencyCurveKnots, tMax);
   DomUtils.setValue("reference", appState.reference);
   refreshSpecDistIfVisible(); }

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

function getDuration() {
   const ampliduteEditorState = amplitudeEditorWidget.getEditorState();
   const frequencyEditorState = frequencyEditorWidget.getEditorState();
   return Math.min(getLastKnotX(ampliduteEditorState.knots) ?? 1, getLastKnotX(frequencyEditorState.knots) ?? 1); }

function getAdjustedFrequencyCurveFunction() {
   const f0Multiplier = DomUtils.getValueNum("f0Multiplier");
   const frequencyCurveFunction = frequencyEditorWidget.getFunction();
   if (f0Multiplier == 1) {
      return frequencyCurveFunction; }
   return (t: number) => frequencyCurveFunction(t) * f0Multiplier; }

function getAdjustedSpectrumCurveFunction() {
   const specMultiplier = DomUtils.getValueNum("specMultiplier");
   const specShift = DomUtils.getValueNum("specShift");
   const spectrumCurveFunction  = spectrumEditorWidget.getFunction();
   if (specMultiplier == 1 && specShift == 0) {
      return spectrumCurveFunction; }
   return (f: number) => spectrumCurveFunction(f / specMultiplier - specShift); }

function genOutputSpectrum() {
   const signal = outputSignal.subarray(0, Math.floor(outputSignal.length / 2) * 2);     // make length even for speed optimization
   const windowFunctionId = DomUtils.getValue("outSpecWindowFunction");
   const windowedSignal = (windowFunctionId == "rect") ? signal : WindowFunctions.applyWindowById(signal, windowFunctionId);
   const spectrum = Fft.fftRealSpectrum(windowedSignal);
   const spectrumAmplitudes = spectrum.getAbsArray();
   const spectrumLog = spectrumAmplitudes.map(DspUtils.convertAmplitudeToDb);
   loadSpectrumViewer(outputSpectrumViewerWidget, spectrumLog, signal.length / outputSampleRate); }

export function synthesize() {
   const sampleRate     = DomUtils.getValueNum("sampleRate");
   const agcRmsLevel    = DomUtils.getValueNum("agcRmsLevel");
   const evenAmplShift  = DomUtils.getValueNum("evenAmplShift");

   const amplitudeCurveFunction = amplitudeEditorWidget.getFunction();

   const sp = <SpecSyn.SynthesizerParms>{};
   sp.sampleRate = sampleRate;
   sp.agcRmsLevel = agcRmsLevel;
   sp.duration = getDuration();
   const spectrumCurveFunctionAdj = getAdjustedSpectrumCurveFunction();
   sp.spectrumCurveFunctionOdd = spectrumCurveFunctionAdj;
   sp.spectrumCurveFunctionEven = (evenAmplShift == 0) ? spectrumCurveFunctionAdj : (f: number) => spectrumCurveFunctionAdj(f) + evenAmplShift;
   sp.amplitudeCurveFunction = amplitudeCurveFunction;
   sp.frequencyCurveFunction = getAdjustedFrequencyCurveFunction();

   outputSignal = SpecSyn.synthesize(sp);
   const averageF0 = SpecSyn.computeAverageF0(sp);
   outputSampleRate = sampleRate;
   outputSignalValid = true;
   loadSignalViewer(outputSignalViewerWidget, outputSignal, outputSampleRate);
   genOutputSpectrum();
   DomUtils.setText("outputSignalInfo", "Average F0 [Hz]: " + Math.round(averageF0));

   refreshMainGui();
   saveUiAppStateToUrl(); }

function synthesizeButton_click() {
   audioPlayer.stop();
   synthesize(); }

async function synthesizeAndPlayButton_click() {
   if (audioPlayer.isPlaying()) {
      audioPlayer.stop();
      return; }
   synthesize();
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
   DomUtils.setText("synthesizeAndPlayButton", audioPlayer.isPlaying() ? "Stop" : "Synth + Play");
   DomUtils.enableElement("playOutputButton", outputSignalValid);
   DomUtils.setText("playOutputButton", audioPlayer.isPlaying() ? "Stop" : "Play");
   DomUtils.enableElement("saveOutputWavFileButton", outputSignalValid); }

function functionCurveEditorHelpButton_click() {
   const t = document.getElementById("functionCurveEditorHelpText")!;
   t.innerHTML = spectrumEditorWidget.getFormattedHelpText();
   t.classList.toggle("hidden"); }

function functionCurveViewerHelpButton2_click() {
   const t = document.getElementById("functionCurveViewerHelpText2")!;
   t.innerHTML = outputSignalViewerWidget.getFormattedHelpText();
   t.classList.toggle("hidden"); }

function polulateWindowFunctionSelect (elementId: string, defaultWindowFunctionId: string) {
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
   const outputSignalViewerCanvas   = <HTMLCanvasElement>document.getElementById("outputSignalViewerCanvas")!;
   const outputSpectrumViewerCanvas = <HTMLCanvasElement>document.getElementById("outputSpectrumViewerCanvas")!;
   spectrumEditorWidget       = new FunctionCurveEditor.Widget(spectrumEditorCanvas);
   amplitudeEditorWidget      = new FunctionCurveEditor.Widget(amplitudeEditorCanvas);
   frequencyEditorWidget      = new FunctionCurveEditor.Widget(frequencyEditorCanvas);
   outputSignalViewerWidget   = new FunctionCurveViewer.Widget(outputSignalViewerCanvas);
   outputSpectrumViewerWidget = new FunctionCurveViewer.Widget(outputSpectrumViewerCanvas);
   polulateWindowFunctionSelect("outSpecWindowFunction", "hann");
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
   DomUtils.addChangeEventListener("f0Multiplier", refreshSpecDistIfVisible);
   DomUtils.addChangeEventListener("evenAmplShift", refreshSpecDistIfVisible);
   amplitudeEditorWidget.addEventListener("change", refreshSpecDistIfVisible);
   frequencyEditorWidget.addEventListener("change", refreshSpecDistIfVisible);
   //
   DomUtils.addChangeEventListener("specMultiplier", refreshSpectrumEditor);
   DomUtils.addChangeEventListener("specShift", refreshSpectrumEditor);
   //
   window.onpopstate = () => catchError(loadUiAppStateFromUrl);
   refreshMainGui(); }
