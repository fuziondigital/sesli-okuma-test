class VoiceMicCheck extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.audioUrl = null;
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;width:100%;font-family:Arial,sans-serif;color:#172033}
        *{box-sizing:border-box}
        .panel{padding:20px;border:1px solid #dce3ed;border-radius:16px;background:#fff}
        h2{margin:0 0 8px;font-size:20px}
        p{margin:0 0 16px;color:#5d6878;font-size:14px;line-height:1.5}
        .status{padding:12px;border-radius:10px;background:#f1f5f9;color:#334155;font-size:14px;line-height:1.45;min-height:44px}
        .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
        button{border:0;border-radius:10px;padding:13px 17px;font-size:15px;font-weight:700;cursor:pointer}
        button:disabled{opacity:.45;cursor:not-allowed}
        #start{background:#166534;color:white}#stop{background:#b91c1c;color:white}#reset{background:#e8edf4;color:#243247}
        .meta{margin-top:12px;color:#475569;font-size:13px}
        audio{width:100%;margin-top:12px}.hint{margin-top:12px;font-size:12px;color:#64748b}
      </style>
      <section class="panel">
        <h2>Mikrofon ve Ses Kaydı Testi</h2>
        <p>Başlat düğmesine basın. Tarayıcı mikrofon izni istediğinde izin verin ve kısa bir cümle söyleyin.</p>
        <div class="status" id="status" role="status" aria-live="polite">Hazır. Mikrofon testi için Başlat düğmesine basın.</div>
        <div class="actions">
          <button id="start" type="button">Mikrofonu Başlat</button>
          <button id="stop" type="button" disabled>Kaydı Durdur</button>
          <button id="reset" type="button">Yeniden Dene</button>
        </div>
        <div class="meta" id="meta">Henüz kayıt yapılmadı.</div>
        <audio id="player" controls hidden></audio>
        <div class="hint">Bu ilk test yalnızca mikrofon erişimini ve ses kaydını kontrol eder. Konuşmayı yazıya çevirmez; ses hiçbir sunucuya gönderilmez.</div>
      </section>`;

    this.$status = this.shadowRoot.querySelector("#status");
    this.$start = this.shadowRoot.querySelector("#start");
    this.$stop = this.shadowRoot.querySelector("#stop");
    this.$meta = this.shadowRoot.querySelector("#meta");
    this.$player = this.shadowRoot.querySelector("#player");
    this.$start.addEventListener("click", () => this.startRecording());
    this.$stop.addEventListener("click", () => this.stopRecording());
    this.shadowRoot.querySelector("#reset").addEventListener("click", () => this.resetTest());
  }

  setStatus(text) { this.$status.textContent = text; }

  async startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      this.setStatus("Bu tarayıcıda mikrofon kaydı desteklenmiyor veya sayfa güvenli HTTPS bağlantısında değil.");
      return;
    }
    try {
      this.setStatus("Mikrofon izni bekleniyor…");
      this.stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      this.chunks = [];
      const types = ["audio/webm;codecs=opus","audio/mp4","audio/webm","audio/ogg;codecs=opus"];
      const mimeType = types.find(t => MediaRecorder.isTypeSupported(t));
      this.recorder = new MediaRecorder(this.stream, mimeType ? {mimeType} : undefined);
      this.recorder.addEventListener("dataavailable", e => { if (e.data?.size) this.chunks.push(e.data); });
      this.recorder.addEventListener("stop", () => this.finishRecording());
      this.startedAt = Date.now();
      this.recorder.start(250);
      this.$start.disabled = true;
      this.$stop.disabled = false;
      this.$meta.textContent = "Mikrofon açık; kayıt devam ediyor.";
      this.setStatus("Kayıt başladı. Şimdi mikrofona kısa bir cümle söyleyin.");
    } catch (e) {
      const msg = {
        NotAllowedError:"Mikrofon izni reddedildi veya Wix iframe'i mikrofon erişimine izin vermiyor.",
        PermissionDeniedError:"Tarayıcı ayarlarından bu siteye mikrofon izni verin.",
        NotFoundError:"Cihazda kullanılabilir mikrofon bulunamadı.",
        NotReadableError:"Mikrofon başka bir uygulama tarafından kullanılıyor veya erişilemiyor.",
        SecurityError:"Güvenlik nedeniyle mikrofon açılamadı. HTTPS bağlantısını kontrol edin."
      };
      this.setStatus(msg[e.name] || `Mikrofon açılamadı: ${e.name || "Bilinmeyen hata"}. ${e.message || ""}`);
      this.$start.disabled = false;
      this.$stop.disabled = true;
      this.stopTracks();
    }
  }

  stopRecording() {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
      this.$stop.disabled = true;
      this.setStatus("Kayıt tamamlanıyor…");
    }
  }

  finishRecording() {
    const seconds = (Date.now() - this.startedAt) / 1000;
    const type = this.recorder?.mimeType || "audio/webm";
    const blob = new Blob(this.chunks, {type});
    this.stopTracks();
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = URL.createObjectURL(blob);
    this.$player.src = this.audioUrl;
    this.$player.hidden = false;
    this.$start.disabled = false;
    this.$stop.disabled = true;
    this.$meta.textContent = `Kayıt süresi: ${seconds.toFixed(1)} saniye · Boyut: ${(blob.size/1024).toFixed(1)} KB · Biçim: ${type}`;
    this.setStatus("Ses kaydı başarıyla alındı. Aşağıdan dinleyebilirsiniz. Ses sunucuya gönderilmedi.");
  }

  stopTracks() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
  }

  resetTest() {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.stopTracks();
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = null;
    this.chunks = [];
    this.$player.removeAttribute("src");
    this.$player.hidden = true;
    this.$meta.textContent = "Henüz kayıt yapılmadı.";
    this.$start.disabled = false;
    this.$stop.disabled = true;
    this.setStatus("Hazır. Mikrofon testi için Başlat düğmesine basın.");
  }

  disconnectedCallback() {
    this.stopTracks();
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
  }
}
if (!customElements.get("voice-mic-check")) customElements.define("voice-mic-check", VoiceMicCheck);
