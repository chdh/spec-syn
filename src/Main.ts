// Main application.

import * as DialogManager from "dialog-manager";

import {catchError} from "./Utils.ts";
import * as AnalysisGui from "./AnalysisGui.ts";
import * as SynthesisGui from "./SynthesisGui.ts";
import InternalAudioPlayer from "./InternalAudioPlayer.js";
import * as DomUtils from "./DomUtils.ts";
import * as Utils from "./Utils.ts";

export var audioPlayer:      InternalAudioPlayer;
export var startupCompleted: boolean = false;

async function performInitialProcessing (inputSignalIsAvailable: boolean) {
   try {
      if (inputSignalIsAvailable) {
         await Utils.showProgressInfo();
         AnalysisGui.analyze(); }
      SynthesisGui.synthesize();
      DialogManager.closeProgressInfo();                                       // popup must be closed before setFocus()
      DomUtils.setFocus("playOutputButton", {preventScroll: true}); }
    finally {
      DialogManager.closeProgressInfo(); }}

async function startup() {
   audioPlayer = new InternalAudioPlayer();
   AnalysisGui.init();
   SynthesisGui.init();
   DomUtils.prepareFieldInfo();
   await AnalysisGui.startup();
   const inputSignalIsAvailable = AnalysisGui.isInputSignalAvailable();
   SynthesisGui.startup(inputSignalIsAvailable);
   await performInitialProcessing(inputSignalIsAvailable);
   startupCompleted = true; }

document.addEventListener("DOMContentLoaded", () => catchError(startup));
