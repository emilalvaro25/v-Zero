/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() sessionReady = false;
  @state() status = '';
  @state() error = '';
  @state() isSettingsOpen = false;
  @state() isMuted = false;
  @state() systemPrompt = 'You are a helpful AI assistant.';
  @state() selectedVoice = 'Orus';

  private client: GoogleGenAI;
  private session: Session;
  private inputAudioContext = new ((window as any).AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new ((window as any).AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      box-sizing: border-box;
      justify-content: space-between;
      align-items: center;
      padding: 24px;
      position: relative;
      background-color: #000;
    }

    .top-controls,
    .bottom-controls {
      display: flex;
      align-items: center;
      position: absolute;
      z-index: 10;
      padding: 0 16px;
    }

    .top-controls {
      top: 16px;
      right: 16px;
      gap: 16px;
    }

    .bottom-controls {
      bottom: 32px;
      left: 50%;
      transform: translateX(-50%);
      gap: 16px;
    }

    .control-button {
      background: #3c4043;
      border: none;
      border-radius: 50%;
      width: 56px;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: white;
      transition: background-color 0.2s ease;
      padding: 0;
    }

    .control-button:hover:not(:disabled) {
      background: #5f6368;
    }

    .control-button:disabled {
      background: #202124;
      opacity: 0.5;
      cursor: not-allowed;
    }

    .control-button.end-call {
      background-color: #ea4335;
    }

    .control-button.end-call:hover {
      background-color: #f28b82;
    }

    .main-content {
      flex-grow: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      position: relative;
    }

    gdm-live-audio-visuals-3d {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }

    /* Modal Styles */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.75);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal-content {
      background-color: #202124;
      color: white;
      padding: 24px;
      border-radius: 16px;
      width: 90%;
      max-width: 500px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      border: 1px solid #5f6368;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .modal-header h2 {
      margin: 0;
      font-size: 1.5rem;
    }

    .close-button {
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
      color: white;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .form-group label {
      font-size: 1rem;
      color: #9e9e9e;
    }

    .form-group textarea,
    .form-group select {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid #5f6368;
      background-color: #3c4043;
      color: white;
      font-size: 1rem;
      box-sizing: border-box;
    }

    .form-group textarea {
      resize: vertical;
      min-height: 100px;
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
    }

    .save-button {
      background-color: #8ab4f8;
      color: #202124;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1rem;
      font-weight: bold;
    }

    .save-button:hover {
      background-color: #9ac2ff;
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Session started');
            this.sessionReady = true;
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Session closed: ' + e.reason);
            this.sessionReady = false;
            if (this.isRecording) {
              this.stopRecording();
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {voiceName: this.selectedVoice},
            },
          },
          // @ts-ignore - systemInstruction is not in the type definition yet
          systemInstruction: this.systemPrompt,
        },
      });
    } catch (e) {
      console.error(e);
      this.updateError(e.message);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();
    this.updateStatus('Requesting microphone...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Listening...');
      this.isRecording = true;

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;
        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);
        this.session.sendRealtimeInput({media: createBlob(pcmData)});
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Mic Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.mediaStream && !this.inputAudioContext) return;

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
      this.scriptProcessorNode = null;
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Not listening');
  }

  private reset() {
    this.stopRecording();
    this.session?.close();
    this.initSession();
    this.updateStatus('Session restarted.');
  }

  private toggleMute() {
    this.isMuted = !this.isMuted;
    this.outputNode.gain.value = this.isMuted ? 0 : 1;
  }

  private openSettings() {
    this.isSettingsOpen = true;
  }

  private closeSettings() {
    this.isSettingsOpen = false;
  }

  private handlePromptChange(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    this.systemPrompt = target.value;
  }

  private handleVoiceChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    this.selectedVoice = target.value;
  }

  private saveSettings() {
    this.closeSettings();
    this.reset();
  }

  render() {
    const ccIcon = html`<svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="white">
      <path
        d="M3.5 14.5H5V12.5H3.5V14.5ZM3.5 11.5H5V9.5H3.5V11.5ZM21 4H3C1.9 4 1 4.9 1 6V18C1 19.1 1.9 20 3 20H21C22.1 20 23 19.1 23 18V6C23 4.9 22.1 4 21 4ZM20 18H4V6H20V18ZM8.5 14.5H10V12.5H8.5V14.5ZM8.5 11.5H10V9.5H8.5V11.5ZM15.5 14.5H11.5V9.5H15.5V14.5Z" />
    </svg>`;

    const volumeIcon = html`<svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="white">
      <path
        d="M3 9V15H7L12 20V4L7 9H3ZM16.5 12C16.5 10.23 15.54 8.71 14 7.97V16.03C15.54 15.29 16.5 13.77 16.5 12Z" />
    </svg>`;

    const settingsIcon = html`<svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="white">
      <path
        d="M10.5 15H13.5V12H10.5V15ZM4.5 15H7.5V12H4.5V15ZM4.5 9H7.5V6H4.5V9ZM10.5 9H13.5V6H10.5V9ZM16.5 9H19.5V6H16.5V9ZM16.5 15H19.5V12H16.5V15Z" />
    </svg>`;

    const videoIcon = html`<svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="white">
      <path
        d="M17 10.5V7C17 6.45 16.55 6 16 6H4C3.45 6 3 6.45 3 7V17C3 17.55 3.45 18 4 18H16C16.55 18 17 17.55 17 17V13.5L21 17.5V6.5L17 10.5Z" />
    </svg>`;

    const micIcon = html`<svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="white"
      xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 14C13.1046 14 14 13.1046 14 12V6C14 4.89543 13.1046 4 12 4C10.8954 4 10 4.89543 10 6V12C10 13.1046 10.8954 14 12 14Z" />
      <path
        d="M17 11H17.01M17 11C17 13.7614 14.7614 16 12 16C9.23858 16 7 13.7614 7 11H5C5 14.866 8.13401 18 12 18C15.866 18 19 14.866 19 11V10.9928" />
      <path d="M12 16V18" />
    </svg>`;

    const moreIcon = html`<svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="white">
      <path
        d="M6 10C4.9 10 4 10.9 4 12C4 13.1 4.9 14 6 14C7.1 14 8 13.1 8 12C8 10.9 7.1 10 6 10ZM18 10C16.9 10 16 10.9 16 12C16 13.1 16.9 14 18 14C19.1 14 20 13.1 20 12C20 10.9 19.1 10 18 10ZM12 10C10.9 10 10 10.9 10 12C10 13.1 10.9 14 12 14C13.1 14 14 13.1 14 12C14 10.9 13.1 10 12 10Z" />
    </svg>`;

    const closeIcon = html`<svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>`;

    const modal = html` <div
      class="modal-overlay"
      @click=${this.closeSettings}>
      <div class="modal-content" @click=${(e: Event) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Settings</h2>
          <button
            class="close-button"
            @click=${this.closeSettings}
            aria-label="Close settings">
            ${closeIcon}
          </button>
        </div>
        <div class="form-group">
          <label for="system-prompt">System Prompt</label>
          <textarea
            id="system-prompt"
            .value=${this.systemPrompt}
            @input=${this.handlePromptChange}></textarea>
        </div>
        <div class="form-group">
          <label for="voice-select">AI Voice</label>
          <select
            id="voice-select"
            .value=${this.selectedVoice}
            @change=${this.handleVoiceChange}>
            <option value="Orus">Orus (Male)</option>
            <option value="Aria">Aria (Female)</option>
            <option value="Leo">Leo (Male)</option>
            <option value="Kai">Kai (Male)</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="save-button" @click=${this.saveSettings}>
            Save and Restart
          </button>
        </div>
      </div>
    </div>`;

    return html`
      ${this.isSettingsOpen ? modal : ''}

      <div class="top-controls">
        <button class="control-button" title="Closed Caption">${ccIcon}</button>
        <button
          class="control-button"
          @click=${this.toggleMute}
          title=${this.isMuted ? 'Unmute' : 'Mute'}>
          ${volumeIcon}
        </button>
        <button
          class="control-button"
          @click=${this.openSettings}
          title="Settings">
          ${settingsIcon}
        </button>
      </div>

      <div class="main-content">
        <gdm-live-audio-visuals-3d
          .outputNode=${this.outputNode}
          .inputNode=${this.inputNode}></gdm-live-audio-visuals-3d>
      </div>

      <div class="bottom-controls">
        <button class="control-button" title="Toggle Video">${videoIcon}</button>
        <button
          class="control-button"
          @click=${this.toggleRecording}
          ?disabled=${!this.sessionReady}
          title=${this.isRecording ? 'Stop recording' : 'Start recording'}>
          ${micIcon}
        </button>
        <button class="control-button" title="More Options">${moreIcon}</button>
        <button
          class="control-button end-call"
          @click=${this.reset}
          title="End call">
          ${closeIcon}
        </button>
      </div>
    `;
  }
}
