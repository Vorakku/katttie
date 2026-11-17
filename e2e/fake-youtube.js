// External SDK fixture only. Never imported by the application or included in dist.
(() => {
  class Player {
    constructor(target, options) {
      this.options = options;
      this.state = -1;
      this.position = 0;
      this.startedAt = Date.now();
      this.videoId = '';
      this.iframe = document.createElement('iframe');
      this.iframe.title = 'YouTube video player';
      this.iframe.style.cssText = 'width:100%;height:100%;min-height:200px;border:0';
      target.replaceWith(this.iframe);
      window.__radioFakePlayers = window.__radioFakePlayers || [];
      window.__radioFakePlayers.push(this);
      setTimeout(() => options.events.onReady({ target: this }), 10);
    }
    emit(state) {
      this.position = this.getCurrentTime();
      this.startedAt = Date.now();
      this.state = state;
      setTimeout(() => this.options.events.onStateChange({ data: state, target: this }), 10);
    }
    cueVideoById(video) { this.videoId = video.videoId; this.position = video.startSeconds; this.state = -1; this.emit(5); }
    loadVideoById(video) { this.videoId = video.videoId; this.position = video.startSeconds; this.state = -1; this.emit(1); }
    playVideo() { this.emit(1); }
    pauseVideo() { this.emit(2); }
    seekTo(position) { this.position = position; this.startedAt = Date.now(); }
    getCurrentTime() { return this.position + (this.state === 1 ? (Date.now() - this.startedAt) / 1000 : 0); }
    getDuration() { return 180; }
    getPlayerState() { return this.state; }
    getVideoData() { return { video_id: this.videoId, title: 'Our test song' }; }
    getIframe() { return this.iframe; }
    setVolume(volume) { this.volume = volume; }
    destroy() { this.iframe.remove(); }
  }
  window.YT = { Player, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  window.onYouTubeIframeAPIReady?.();
})();
