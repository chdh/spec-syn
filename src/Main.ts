// Main application.

import {catchError} from "./Utils.ts";
import * as AnalysisGui from "./AnalysisGui.ts";
import * as SynthesisGui from "./SynthesisGui.ts";
import InternalAudioPlayer from "./InternalAudioPlayer.js";

export var audioPlayer:      InternalAudioPlayer;

async function startup() {
   audioPlayer = new InternalAudioPlayer();
   SynthesisGui.init();
   await AnalysisGui.init(); }

document.addEventListener("DOMContentLoaded", () => catchError(startup));
