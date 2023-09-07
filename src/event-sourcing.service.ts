import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as mongoDB from 'mongodb';

import { EVENT_SOURCING_MODULE_OPTIONS } from './event-sourcing.constants';
import { EventSourcingModuleOptions } from './event-sourcing.interface';
import { Event } from './models';
import { BaseEvent } from './events';
import { ExtendedAggregateRoot } from './aggregate';

@Injectable()
export class EventSourcingService<T extends ExtendedAggregateRoot> implements OnModuleInit, OnModuleDestroy {
  private mongoClient: mongoDB.MongoClient;
  private eventStoreCollection: mongoDB.Collection<Event>;

  constructor(@Inject(EVENT_SOURCING_MODULE_OPTIONS) private readonly options: EventSourcingModuleOptions) {}

  public async onModuleInit(): Promise<void> {
    this.mongoClient = new mongoDB.MongoClient(this.options.mongoUrl);

    await this.mongoClient.connect();

    this.eventStoreCollection = this.mongoClient.db().collection('eventStore');
  }

  public onModuleDestroy(): void {
    this.mongoClient.close();
  }

  private findByAggregateIdentifier(aggregateIdentifier: string): Promise<Event[]> {
    return this.eventStoreCollection.find({ aggregateIdentifier }).toArray();
  }

  public async saveEvents(aggregate: T): Promise<void> {
    const events: BaseEvent[] = aggregate.getUncommittedEvents();
    const eventStream: Event[] = await this.findByAggregateIdentifier(aggregate.id);

    if (aggregate.version != -1 && eventStream[eventStream.length - 1].version !== aggregate.version) {
      console.log('TODO: Concurrency exception');
    }

    let version: number = aggregate.version;

    for (const event of events) {
      const { constructor } = Object.getPrototypeOf(event);

      version++;
      event.version = version;

      const eventModel: Event = new Event();
      eventModel.aggregateIdentifier = aggregate.id;
      eventModel.aggregateType = aggregate.type;
      eventModel.eventType = constructor.name;
      eventModel.version = version;
      eventModel.eventData = event;
      eventModel.timeStamp = new Date();

      await this.eventStoreCollection.insertOne(eventModel);
    }
  }

  public async getEvents(aggregateId: string): Promise<BaseEvent[] | never> {
    const eventStream: Event[] = await this.findByAggregateIdentifier(aggregateId);

    if (!eventStream || !eventStream.length) {
      return;
    }

    return eventStream.map((aggregate: Event) => {
      (aggregate.eventData as any).constructor = { name: aggregate.eventType };
      aggregate.eventData = Object.assign(Object.create(aggregate.eventData), aggregate.eventData);

      return aggregate.eventData;
    });
  }
}
