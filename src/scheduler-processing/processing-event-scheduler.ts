import debug from 'debug';
import * as schedule from 'node-schedule';
import { EventItem, MSQueueRequestHandler } from '../event-manager';
import { container } from '../inversify';
import { ProcessingConfig } from './processing-config';

const log = debug('ms-queue:EventScheduler');

class ProcessingEventScheduler {
  private Config: { MAX_COUNT: number } = { MAX_COUNT: 1 };

  private readonly hostName: string;

  private readonly queueName: string;

  private job: schedule.Job;

  private config: ProcessingConfig;

  private msQueueRequestHandler: MSQueueRequestHandler;

  constructor(hostName: string, queueName: string, listener: (item: EventItem) => Promise<void>, cronInterval?: string) {
    this.hostName = hostName;
    this.queueName = queueName;
    this.config = container.get(ProcessingConfig);
    this.config.listener = listener;
    this.msQueueRequestHandler = new MSQueueRequestHandler();
    this.initialize(cronInterval);
    this.setParallelProcessingCount(1);
  }

  setParallelProcessingCount(count: number): void {
    this.Config.MAX_COUNT = count;
  }

  cancel(): void {
    this.job.cancel();
  }

  private initialize(cronInterval: string = '15 * * * * *'): void {
    log('Adding scheduler job for event slave.');
    this.job = schedule.scheduleJob(cronInterval, () => !this.config.polling && this.checkIfMoreItemsCanBeProcessed());
  }

  private checkIfMoreItemsCanBeProcessed(): void {
    this.config.polling = true;
    if (this.config.config.count >= this.Config.MAX_COUNT) {
      return;
    }
    while (this.config.config.count < this.Config.MAX_COUNT && this.config.hasMore) {
      this.requestEventToProcess();
    }
    if (!this.config.config.count && !this.config.hasMore) {
      this.config.polling = false;
      this.config.hasMore = true;
    }
  }

  private requestEventToProcess(): void {
    this.config.config.count += 1;
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    setTimeout(async () => {
      try {
        const eventItem: EventItem = await this.msQueueRequestHandler.fetchEventsFromQueue(this.hostName, this.queueName);
        if (!eventItem) {
          this.config.hasMore = false;
        } else {
          await this.config.listener(eventItem);
        }
      } catch (error) {
        log(error);
        if (!error.code && error.message.startsWith('Error: connect ECONNREFUSED')) {
          this.config.hasMore = false;
        }
      }
      this.config.config.count -= 1;
      this.checkIfMoreItemsCanBeProcessed();
    }, 0);
  }
}

export { ProcessingEventScheduler };