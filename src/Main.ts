// Main GUI application.

import * as Utils from "./Utils.ts";
import {catchError} from "./Utils.ts";
import InternalAudioPlayer from "./InternalAudioPlayer.js";
import * as DomUtils from "./DomUtils.ts";
import * as SpecSyn from "./SpecSyn.ts";
import * as AppStateMgr from "./AppStateMgr.ts";
import {AppState} from "./AppStateMgr.ts";
import * as WavFileEncoder from "wav-file-encoder";
import * as FunctionCurveViewer from "function-curve-viewer";
import * as FunctionCurveEditor from "function-curve-editor";
import {Point} from "function-curve-editor";

var audioPlayer:                       InternalAudioPlayer;

// GUI components:
var spectrumEditorWidget:              FunctionCurveEditor.Widget;
var amplitudeEditorWidget:             FunctionCurveEditor.Widget;
var frequencyEditorWidget:             FunctionCurveEditor.Widget;
var outputSignalViewerWidget:          FunctionCurveViewer.Widget;

// Output signal:
var outputSignalValid:                 boolean = false;
var outputSignal:                      Float64Array;
var outputSampleRate:                  number;

//--- Curve editors -----------------------------------------------------------

function loadSpectrumCurveEditor (knots: Point[]) {
   const editorState: Partial<FunctionCurveEditor.EditorState> = {
      knots:           knots,
      xMin:            0,
      xMax:            5500,
      yMin:            -100,
      yMax:            0,
      extendedDomain:  false,
      relevantXMin:    0,
      gridEnabled:     true,
      primaryZoomMode: FunctionCurveEditor.ZoomMode.x,
      xAxisUnit:       "Hz",
      yAxisUnit:       "dB",
      focusShield:     true };
   spectrumEditorWidget.setEditorState(editorState); }

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

//--- App state ---------------------------------------------------------------

function getAppStateFromUi() {
   const appState = <AppState>{};
   appState.sampleRate   = DomUtils.getValueNum("sampleRate");
   appState.agcRmsLevel  = DomUtils.getValueNum("agcRmsLevel");
   appState.f0Multiplier = DomUtils.getValueNum("f0Multiplier");
   appState.spectrumCurveKnots = spectrumEditorWidget.getEditorState().knots;
   appState.amplitudeCurveKnots = amplitudeEditorWidget.getEditorState().knots;
   appState.frequencyCurveKnots = frequencyEditorWidget.getEditorState().knots;
   return appState; }

function getLastKnotX (knots: Point[]) : number | undefined {
   return knots.length ? knots[knots.length - 1].x : undefined; }

function setAppStateToUi (appState: AppState) {
   DomUtils.setValueNum("sampleRate",   appState.sampleRate);
   DomUtils.setValueNum("agcRmsLevel",  appState.agcRmsLevel);
   DomUtils.setValueNum("f0Multiplier", appState.f0Multiplier);
   const tMax = Math.min(getLastKnotX(appState.amplitudeCurveKnots) ?? 5, getLastKnotX(appState.frequencyCurveKnots) ?? 5);
   loadSpectrumCurveEditor(appState.spectrumCurveKnots);
   loadAmplitudeCurveEditor(appState.amplitudeCurveKnots, tMax);
   loadFrequencyCurveEditor(appState.frequencyCurveKnots, tMax); }

function loadUiAppStateFromUrl() {
   const urlParmsString = window.location.hash.substring(1);
   const appState = AppStateMgr.decodeAppStateUrlParms(urlParmsString);
   setAppStateToUi(appState); }

function saveUiAppStateToUrl() {
   const appState = getAppStateFromUi();
   const urlParmsString = AppStateMgr.encodeAppStateUrlParms(appState);
   if (urlParmsString == window.location.hash.substring(1)) {
      return; }
   window.history.pushState(null, "", "#" + urlParmsString); }

//-----------------------------------------------------------------------------

function synthesizeButton_click() {
   audioPlayer.stop();
   outputSampleRate   = DomUtils.getValueNum("sampleRate");
   const agcRmsLevel  = DomUtils.getValueNum("agcRmsLevel");
   const f0Multiplier = DomUtils.getValueNum("f0Multiplier");
   const spectrumCurveFunction = spectrumEditorWidget.getFunction();
   const amplitudeCurveFunction = amplitudeEditorWidget.getFunction();
   const ampliduteEditorState = amplitudeEditorWidget.getEditorState();
   const frequencyCurveFunction = frequencyEditorWidget.getFunction();
   const frequencyEditorState = frequencyEditorWidget.getEditorState();
   const duration = Math.min(getLastKnotX(ampliduteEditorState.knots) ?? 1, getLastKnotX(frequencyEditorState.knots) ?? 1);
   const frequencyCurveFunction2 = (f0Multiplier == 1) ? frequencyCurveFunction : (t: number) => frequencyCurveFunction(t) * f0Multiplier;
   outputSignal = SpecSyn.synthesize(spectrumCurveFunction, amplitudeCurveFunction, frequencyCurveFunction2, duration, outputSampleRate, agcRmsLevel);
   outputSignalValid = true;
   loadSignalViewer(outputSignalViewerWidget, outputSignal, outputSampleRate);
   refreshMainGui();
   saveUiAppStateToUrl(); }

async function synthesizeAndPlayButton_click() {
   if (audioPlayer.isPlaying()) {
      audioPlayer.stop();
      return; }
   synthesizeButton_click();
   await playOutputButton_click(); }

async function playOutputButton_click() {
   if (audioPlayer.isPlaying()) {
      audioPlayer.stop();
      return; }
   await audioPlayer.playSamples(outputSignal, outputSampleRate); }

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

function functionCurveViewerHelpButton_click() {
   const t = document.getElementById("functionCurveViewerHelpText")!;
   t.innerHTML = outputSignalViewerWidget.getFormattedHelpText();
   t.classList.toggle("hidden"); }

function startup() {
   audioPlayer = new InternalAudioPlayer();
   audioPlayer.addEventListener("stateChange", refreshMainGui);
   const spectrumEditorCanvas     = <HTMLCanvasElement>document.getElementById("spectrumEditorCanvas")!;
   const amplitudeEditorCanvas    = <HTMLCanvasElement>document.getElementById("amplitudeEditorCanvas")!;
   const frequencyEditorCanvas    = <HTMLCanvasElement>document.getElementById("frequencyEditorCanvas")!;
   const outputSignalViewerCanvas = <HTMLCanvasElement>document.getElementById("outputSignalViewerCanvas")!;
   spectrumEditorWidget     = new FunctionCurveEditor.Widget(spectrumEditorCanvas);
   amplitudeEditorWidget    = new FunctionCurveEditor.Widget(amplitudeEditorCanvas);
   frequencyEditorWidget    = new FunctionCurveEditor.Widget(frequencyEditorCanvas);
   outputSignalViewerWidget = new FunctionCurveViewer.Widget(outputSignalViewerCanvas);
   DomUtils.addClickEventListener("synthesizeButton", synthesizeButton_click);
   DomUtils.addClickEventListener("synthesizeAndPlayButton", synthesizeAndPlayButton_click);
   DomUtils.addClickEventListener("playOutputButton", playOutputButton_click);
   DomUtils.addClickEventListener("saveOutputWavFileButton", saveOutputWavFileButton_click);
   DomUtils.addClickEventListener("functionCurveEditorHelpButton", functionCurveEditorHelpButton_click);
   DomUtils.addClickEventListener("functionCurveViewerHelpButton", functionCurveViewerHelpButton_click);
   window.onpopstate = () => Utils.catchError(loadUiAppStateFromUrl);
   loadUiAppStateFromUrl();
   refreshMainGui(); }

document.addEventListener("DOMContentLoaded", () => catchError(startup));
