// Analysis GUI.

import * as WavFileEncoder from "wav-file-encoder";
import * as FunctionCurveViewer from "function-curve-viewer";
import * as PitchDetectionHarm from "dsp-collection/signal/PitchDetectionHarm";
import * as WindowFunctions from "dsp-collection/signal/WindowFunctions";
import * as DialogManager from "dialog-manager";

import * as Utils from "./Utils.ts";
import {catchError, formatNumber} from "./Utils.ts";
import * as DomUtils from "./DomUtils.ts";
import * as AudioUtils from "./AudioUtils.ts";
import {audioPlayer} from "./Main.ts";
import {AppStateUpdate} from "./AppStateMgr.ts";
import * as AnalysisSpec from "./AnalysisSpec.ts";
import * as AnalysisAmpl from "./AnalysisAmpl.ts";
import * as AnalysisFreq from "./AnalysisFreq.ts";
import * as SynthesisGui from "./SynthesisGui.ts";

// GUI components:
var inputSignalViewerWidget:           FunctionCurveViewer.Widget;

// Input signal:
var inputSignalValid:                  boolean = false;
var inputSignal:                       Float32Array;                 // input signal samples
var inputSignalStart:                  number;                       // sample position of start of selected segment
var inputSignalEnd:                    number;                       // sample position of end of selected segment
var inputSampleRate:                   number;
var inputFileName:                     string;
var inputFileF0:                       number;                       // fundamental frequency associated with input file or 0

//--- Signal viewer ------------------------------------------------------------

function loadSignalViewer (widget: FunctionCurveViewer.Widget, signal: ArrayLike<number>, sampleRate: number) {
   const viewerFunction = FunctionCurveViewer.createViewerFunctionForArray(signal, {scalingFactor: sampleRate});
   const yRange = 1.2;
   const viewerState : Partial<FunctionCurveViewer.ViewerState> = {
      viewerFunction:   viewerFunction,
      xMin:             0,
      xMax:             signal.length / sampleRate,
      yMin:             -yRange,
      yMax:             yRange,
      gridEnabled:      true,
      primaryZoomMode:  FunctionCurveViewer.ZoomMode.x,
      xAxisUnit:        "s",
      focusShield:      true };
   widget.setViewerState(viewerState); }

function inputSignalViewer_segmentChange() {
   const vState = inputSignalViewerWidget.getViewerState();
   if (vState.segmentSelected) {
      const x1 = Math.round(vState.segmentStart * inputSampleRate);
      const x2 = Math.round(vState.segmentEnd   * inputSampleRate);
      inputSignalStart = Math.max(0, Math.min(inputSignal.length, x1));
      inputSignalEnd   = Math.max(0, Math.min(inputSignal.length, x2)); }
    else {
      inputSignalStart = 0;
      inputSignalEnd = inputSignal.length; }
   setInputSignalInfo();
   refreshMainGui(); }

//--- Load audio file ----------------------------------------------------------

function setF0ReferenceFromPitch() {
   if (!isInputSignalAvailable()) {
      DomUtils.setValueNum("f0Reference", undefined);
      return; }
   const pitchPos = (inputSignalStart + inputSignalEnd) / 2 / inputSampleRate;
   const pitch = PitchDetectionHarm.estimatePitch_harmonicSum(inputSignal, inputSampleRate, pitchPos);
   DomUtils.setValueNum("f0Reference", Math.round(pitch)); }

function recalculateF0ReferenceButton_click() {
   setF0ReferenceFromPitch();
   DialogManager.showToast({msgText: "F0 reference updated."}); }

function initF0Reference() {
   if (inputFileF0) {
      DomUtils.setValueNum("f0Reference", inputFileF0); }
    else {
      setF0ReferenceFromPitch(); }}

async function loadAudioFileData (fileData: ArrayBuffer, fileName: string, f0: number = 0) {
   const audioData = await AudioUtils.decodeAudioFileData(fileData);
   inputSignal = audioData.channelData[0];                 // only the first channel is used
   inputSignalStart = 0;
   inputSignalEnd = inputSignal.length;
   inputSampleRate = audioData.sampleRate;
   inputFileName = fileName;
   inputFileF0 = f0;
   inputSignalValid = true;
   loadSignalViewer(inputSignalViewerWidget, inputSignal, inputSampleRate);
   initF0Reference();
   setInputSignalInfo();
   refreshMainGui(); }

async function loadFileFromUrl (url: string) : Promise<ArrayBuffer> {
   const response = await fetch(url, {mode: "cors", credentials: "include"}); // (server must send "Access-Control-Allow-Origin" header field or have same origin)
   if (!response.ok) {
      throw new Error("Request failed for " + url); }
   return await response.arrayBuffer(); }

async function loadAudioFileFromUrl (url: string, f0: number) {
   const fileData = await loadFileFromUrl(url);
   const fileName = url.substring(url.lastIndexOf("/") + 1);
   await loadAudioFileData(fileData, fileName, f0); }

async function loadLocalAudioFile (file: File) {
   const fileData = await file.arrayBuffer();
   await loadAudioFileData(fileData, file.name); }

function loadLocalAudioFileButton_click() {
   audioPlayer.stop();
   Utils.openFileOpenDialog((file: File) => catchError(loadLocalAudioFile, file)); }

function getInputSignalSelection() {
   return inputSignal.subarray(inputSignalStart, inputSignalEnd); }

function isInputSignalWhole() : boolean {
   return inputSignalStart == 0 && inputSignalEnd == inputSignal.length; }

export function isInputSignalAvailable() : boolean {
   return !!inputSignalValid && inputSignalEnd > inputSignalStart; }

//--- Analysis -----------------------------------------------------------------

function analyzeSpectrum (appState: AppStateUpdate) {
   const parms = <AnalysisSpec.GuiParms>{};
   parms.f0Reference        = DomUtils.getValueNum("f0Reference");
   parms.analSpecMethod     = DomUtils.getValue("analSpecMethod");
   parms.analSpecWidth1     = DomUtils.getValueNum("analSpecWidth1");
   parms.analSpecFunc1      = DomUtils.getValue("analSpecFunc1");
   parms.analSpecWidth2     = DomUtils.getValueNum("analSpecWidth2");
   parms.analSpecFunc2      = DomUtils.getValue("analSpecFunc2");
   parms.analSpecMaxFreq    = DomUtils.getValueNum("analSpecMaxFreq");
   parms.analSpecStepWidth  = DomUtils.getValueNum("analSpecStepWidth");
   parms.analSpecWindowFunc = DomUtils.getValue("analSpecWindowFunc");
   const {spectrumCurveKnots, origSpecCurveFunction} = AnalysisSpec.analyzeSpectrum(getInputSignalSelection(), inputSampleRate, parms);
   appState.spectrumCurveKnots = spectrumCurveKnots;
   appState.origSpecCurveFunction = origSpecCurveFunction; }

function analyzeAmplitudeCurve (appState: AppStateUpdate) {
   const parms = <AnalysisAmpl.GuiParms>{};
   parms.analAmplStepWidth = DomUtils.getValueNum("analAmplStepWidth") / 1000; // convert [ms] to [s]
   appState.amplitudeCurveKnots = AnalysisAmpl.analyzeAmplitudeCurve(getInputSignalSelection(), inputSampleRate, parms); }

function analyzeFrequencyCurve (appState: AppStateUpdate) {
   const parms = <AnalysisFreq.GuiParms>{};
   parms.analFreqStepWidth = DomUtils.getValueNum("analFreqStepWidth") / 1000; // convert [ms] to [s]
   appState.frequencyCurveKnots = AnalysisFreq.analyzeFrequencyCurve(getInputSignalSelection(), inputSampleRate, parms); }

export function analyze() {
   const appState: AppStateUpdate = {};
   if (DomUtils.getChecked("analSpecEnabled")) {
      analyzeSpectrum(appState); }
   if (DomUtils.getChecked("analAmplEnabled")) {
      analyzeAmplitudeCurve(appState); }
   if (DomUtils.getChecked("analFreqEnabled")) {
      analyzeFrequencyCurve(appState); }
   SynthesisGui.updateAppStateFromAnalysis(appState); }

async function analyzeButton_click() {
   audioPlayer.stop();
   try {
      await Utils.showProgressInfo();
      analyze(); }
    finally {
      DialogManager.closeProgressInfo(); }}

async function analAndSynthButton_click() {
   audioPlayer.stop();
   try {
      await Utils.showProgressInfo();
      analyze();
      SynthesisGui.synthesize(); }
    finally {
      DialogManager.closeProgressInfo(); }}

async function analSynthPlayButton_click() {
   if (audioPlayer.isPlaying()) {
      audioPlayer.stop();
      return; }
   await analAndSynthButton_click();
   await SynthesisGui.playOutputSignal(); }

//------------------------------------------------------------------------------

function setInputSignalInfo() {
   const t = (p: number) => (p / inputSampleRate).toFixed(3) + " s";
   let s: string;
   if (!inputSignalValid) {
      s = ""; }
    else if (isInputSignalWhole()) {
      s = `Whole sound: ${t(inputSignalEnd)} = ${formatNumber(inputSignalEnd)} samples`; }
    else {
      s = `Selected: ${t(inputSignalStart)} - ${t(inputSignalEnd)} = ${t(inputSignalEnd - inputSignalStart)} = ${formatNumber(inputSignalEnd - inputSignalStart)} samples`; }
   DomUtils.setText("inputSignalSelectionInfo", s);
   DomUtils.setText("inputSignalSampleRate", `Sample Rate: ${formatNumber(inputSampleRate)}`); }

function refreshGuiDependencies_analSpecMethod() {
   const analSpecMethod = DomUtils.getValue("analSpecMethod");
   const isDualFirLp = analSpecMethod == "firLpPwrLog";
   DomUtils.showElement("analSpecFunc1Field", isDualFirLp);
   DomUtils.showElement("analSpecWidth2Field", isDualFirLp);
   DomUtils.showElement("analSpecFunc2Field", isDualFirLp); }

var playInputButtonText:         string|undefined = undefined;
var analSynthPlayButtonTextText: string|undefined = undefined;

function refreshMainGui() {
   playInputButtonText ??= DomUtils.getText("playInputButton");
   analSynthPlayButtonTextText ??= DomUtils.getText("analSynthPlayButton");
   const newPlayInputButtonText = audioPlayer.isPlaying() ? "Stop" : playInputButtonText;
   const newAnalSynthPlayButtonText = audioPlayer.isPlaying() ? "Stop" : analSynthPlayButtonTextText;
   //
   inputSignalViewerWidget.disabled = !inputSignalValid;
   DomUtils.enableElement("playInputButton", isInputSignalAvailable());
   DomUtils.setText("playInputButton", newPlayInputButtonText);
   DomUtils.enableElement("saveInputWavFileButton", isInputSignalAvailable());
   const analysisSubEnabled = DomUtils.getChecked("analSpecEnabled") || DomUtils.getChecked("analAmplEnabled") || DomUtils.getChecked("analFreqEnabled");
   const analysisEnabled = isInputSignalAvailable() && analysisSubEnabled;
   DomUtils.enableElement("analyzeButton", analysisEnabled);
   DomUtils.enableElement("analAndSynthButton", analysisEnabled);
   DomUtils.enableElement("analSynthPlayButton", analysisEnabled);
   DomUtils.setText("analSynthPlayButton", newAnalSynthPlayButtonText);
   refreshGuiDependencies_analSpecMethod(); }

async function playInputButton_click() {
   if (audioPlayer.isPlaying()) {
      audioPlayer.stop();
      return; }
   await audioPlayer.playSamples(getInputSignalSelection(), inputSampleRate); }

function saveInputWavFileButton_click() {
   audioPlayer.stop();
   const wavFileData = WavFileEncoder.encodeWavFile2([getInputSignalSelection()], inputSampleRate, WavFileEncoder.WavFileType.float32);
   const fileName = Utils.removeFileNameExtension(inputFileName) + (isInputSignalWhole() ? "" : "-sel") + ".wav";
   Utils.openSaveAsDialog(wavFileData, fileName, "audio/wav", "wav", "WAV audio file"); }

function showAnalysisSection (show: boolean = true) {
   document.body.classList.toggle("analysisHidden", !show); }

function functionCurveViewerHelpButton1_click() {
   const t = document.getElementById("functionCurveViewerHelpText1")!;
   t.innerHTML = inputSignalViewerWidget.getFormattedHelpText();
   t.classList.toggle("hidden"); }

export async function startup() {
   const parmsString = window.location.hash.substring(1);
   const usp = new URLSearchParams(parmsString);
   const audioFileUrl = usp.get("file");
   const f0 = Number(usp.get("f0") ?? "0");
   if (audioFileUrl) {
      await Utils.showProgressInfo();
      showAnalysisSection();
      await loadAudioFileFromUrl(audioFileUrl, f0); }
   refreshMainGui(); }

function populateWindowFunctionSelect (elementId: string, defaultWindowFunctionId: string, addNone = false) {
   const selectElement = <HTMLSelectElement>document.getElementById(elementId)!;
   for (const d of WindowFunctions.windowFunctionIndex) {
      const selected = d.id == defaultWindowFunctionId;
      selectElement.add(new Option(d.name, d.id, selected, selected)); }
   if (addNone) {
      selectElement.add(new Option("none", "none")); }}

export function init() {
   audioPlayer.addEventListener("stateChange", refreshMainGui);
   const inputSignalViewerCanvas = <HTMLCanvasElement>document.getElementById("inputSignalViewerCanvas")!;
   inputSignalViewerWidget = new FunctionCurveViewer.Widget(inputSignalViewerCanvas);
   populateWindowFunctionSelect("analSpecWindowFunc", "hann");
   populateWindowFunctionSelect("analSpecFunc1", "parabolic", true);
   populateWindowFunctionSelect("analSpecFunc2", "parabolic", true);
   //
   DomUtils.addClickEventListener("showAnalysisLink", showAnalysisSection);
   DomUtils.addClickEventListener("hideAnalysisLink", () => showAnalysisSection(false));
   DomUtils.addClickEventListener("functionCurveViewerHelpButton1", functionCurveViewerHelpButton1_click);
   DomUtils.addClickEventListener("loadLocalAudioFileButton", loadLocalAudioFileButton_click);
   DomUtils.addClickEventListener("playInputButton", playInputButton_click);
   DomUtils.addClickEventListener("saveInputWavFileButton", saveInputWavFileButton_click);
   DomUtils.addClickEventListener("recalculateF0ReferenceButton", recalculateF0ReferenceButton_click);
   DomUtils.addClickEventListener("analyzeButton", analyzeButton_click);
   DomUtils.addClickEventListener("analAndSynthButton", analAndSynthButton_click);
   DomUtils.addClickEventListener("analSynthPlayButton", analSynthPlayButton_click);
   inputSignalViewerWidget.addEventListener("segmentchange", () => catchError(inputSignalViewer_segmentChange));
   DomUtils.addChangeEventListener("analSpecEnabled", refreshMainGui);
   DomUtils.addChangeEventListener("analAmplEnabled", refreshMainGui);
   DomUtils.addChangeEventListener("analFreqEnabled", refreshMainGui);
   DomUtils.addChangeEventListener("analSpecMethod", refreshMainGui);
   //
   refreshMainGui(); }
