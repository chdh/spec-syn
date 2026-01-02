// Main application.

import * as DialogManager from "dialog-manager";

import {catchError} from "./Utils.ts";
import * as AnalysisGui from "./AnalysisGui.ts";
import * as SynthesisGui from "./SynthesisGui.ts";
import InternalAudioPlayer from "./InternalAudioPlayer.js";
import * as Utils from "./Utils.ts";

export var audioPlayer:      InternalAudioPlayer;
export var startupCompleted: boolean = false;

async function performInitialProcessing() {
   try {
      await Utils.showProgressInfo();
      AnalysisGui.analyze();
      SynthesisGui.synthesize(); }
    finally {
      DialogManager.closeProgressInfo(); }}

async function startup() {
   audioPlayer = new InternalAudioPlayer();
   AnalysisGui.init();
   SynthesisGui.init();
   await AnalysisGui.startup();
   const doInitProc = AnalysisGui.isInputSignalAvailable();
   SynthesisGui.startup(doInitProc);
   if (doInitProc) {
      await performInitialProcessing(); }
   startupCompleted = true; }

document.addEventListener("DOMContentLoaded", () => catchError(startup));
