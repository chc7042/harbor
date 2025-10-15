class PollingService {
  constructor() {
    this.intervals = new Map();
    this.subscribers = new Map();
    this.isActive = false;
  }

  /**
   * 폴링 시작
   * @param {string} key - 폴링 식별자
   * @param {function} callback - 실행할 콜백 함수
   * @param {number} interval - 폴링 간격 (ms)
   */
  start(key, callback, interval = 30000) {
    this.stop(key); // 기존 폴링 중지

    const intervalId = setInterval(async () => {
      try {
        await callback();
      } catch (error) {
        console.error(`Polling error for ${key}:`, error);
        // 에러가 발생해도 폴링은 계속 진행
      }
    }, interval);

    this.intervals.set(key, intervalId);
    this.isActive = true;
    this.emit('polling_status_changed', { isActive: true, activePolling: this.getActivePolling() });
    console.log(`Polling started for ${key} with ${interval}ms interval`);
  }

  /**
   * 폴링 중지
   * @param {string} key - 폴링 식별자
   */
  stop(key) {
    const intervalId = this.intervals.get(key);
    if (intervalId) {
      clearInterval(intervalId);
      this.intervals.delete(key);
      console.log(`Polling stopped for ${key}`);
    }

    if (this.intervals.size === 0) {
      this.isActive = false;
    }
    this.emit('polling_status_changed', { isActive: this.isActive, activePolling: this.getActivePolling() });
  }

  /**
   * 모든 폴링 중지
   */
  stopAll() {
    this.intervals.forEach((intervalId, key) => {
      clearInterval(intervalId);
      console.log(`Polling stopped for ${key}`);
    });
    this.intervals.clear();
    this.isActive = false;
    this.emit('polling_status_changed', { isActive: false, activePolling: [] });
  }

  /**
   * 이벤트 구독
   * @param {string} event - 이벤트 이름
   * @param {function} callback - 콜백 함수
   */
  on(event, callback) {
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, new Set());
    }
    this.subscribers.get(event).add(callback);
  }

  /**
   * 이벤트 구독 해제
   * @param {string} event - 이벤트 이름
   * @param {function} callback - 콜백 함수
   */
  off(event, callback) {
    const eventSubscribers = this.subscribers.get(event);
    if (eventSubscribers) {
      eventSubscribers.delete(callback);
      if (eventSubscribers.size === 0) {
        this.subscribers.delete(event);
      }
    }
  }

  /**
   * 이벤트 발생
   * @param {string} event - 이벤트 이름
   * @param {any} data - 데이터
   */
  emit(event, data) {
    const eventSubscribers = this.subscribers.get(event);
    if (eventSubscribers) {
      eventSubscribers.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  /**
   * 폴링 상태 확인
   * @returns {boolean}
   */
  isPollingActive() {
    return this.isActive;
  }

  /**
   * 활성 폴링 목록 반환
   * @returns {string[]}
   */
  getActivePolling() {
    return Array.from(this.intervals.keys());
  }

  /**
   * 폴링 간격 변경
   * @param {string} key - 폴링 식별자
   * @param {function} callback - 콜백 함수
   * @param {number} newInterval - 새로운 폴링 간격
   */
  changeInterval(key, callback, newInterval) {
    if (this.intervals.has(key)) {
      this.stop(key);
      this.start(key, callback, newInterval);
    }
  }
}

// 싱글톤 인스턴스
const pollingService = new PollingService();

export default pollingService;