import { MongoClient } from 'mongodb';

function serializeTrack(track) {
    if (!track || typeof track.id !== 'string' || typeof track.title !== 'string') {
        throw new Error('Cannot persist a queue track without a valid id and title.');
    }

    return {
        id: track.id,
        title: track.title,
        artist: typeof track.artist === 'string' ? track.artist : '',
        album: typeof track.album === 'string' ? track.album : '',
        artwork: typeof track.artwork === 'string' ? track.artwork : '',
        duration: Number(track.duration) || 0,
        url: typeof track.url === 'string' ? track.url : '',
        sourceUrl: typeof track.sourceUrl === 'string' ? track.sourceUrl : '',
        requestedBy: typeof track.requestedBy === 'string' ? track.requestedBy : ''
    };
}

function restoreTrack(track) {
    if (!track || typeof track.id !== 'string' || typeof track.title !== 'string') {
        throw new Error('MongoDB contains a queue track without a valid id and title.');
    }
    return serializeTrack(track);
}

function restoreDocument(document) {
    if (!document || typeof document.serverId !== 'string'
        || typeof document.voiceChannelId !== 'string'
        || typeof document.textChannelId !== 'string'
        || !Array.isArray(document.queue)) {
        throw new Error('MongoDB contains a malformed saved queue document.');
    }

    const queue = document.queue.map(restoreTrack);
    if (document.current) queue.unshift(restoreTrack(document.current));

    const volume = Number(document.volume);
    const loopMode = ['off', 'song', 'queue'].includes(document.loopMode) ? document.loopMode : 'off';
    return {
        serverId: document.serverId,
        state: {
            voiceChannelId: document.voiceChannelId,
            textChannelId: document.textChannelId,
            queue,
            current: null,
            currentProcess: null,
            call: null,
            worker: null,
            stopping: false,
            skipRequested: false,
            loopMode,
            volume: Number.isInteger(volume) && volume >= 0 && volume <= 100 ? volume : 100,
            paused: false,
            startedAt: 0,
            pausedAt: null,
            pausedDuration: 0,
            persistenceWarningSent: false
        }
    };
}

export function createQueueStore(client, databaseName = 'musicfr', collectionName = 'yapin_queues') {
    const collection = client.db(databaseName).collection(collectionName);

    return {
        async initialize() {
            await collection.createIndex({ serverId: 1 }, { unique: true });
        },

        async loadAll() {
            const documents = await collection.find({}).toArray();
            return documents.map(restoreDocument);
        },

        async save(serverId, state) {
            if (state.stopping || (!state.current && state.queue.length === 0)) {
                await collection.deleteOne({ serverId });
                return;
            }

            const document = {
                serverId,
                voiceChannelId: state.voiceChannelId,
                textChannelId: state.textChannelId,
                current: state.current ? serializeTrack(state.current) : null,
                queue: state.queue.map(serializeTrack),
                loopMode: state.loopMode,
                volume: state.volume,
                updatedAt: new Date()
            };
            await collection.replaceOne({ serverId }, document, { upsert: true });
        },

        close() {
            return client.close();
        }
    };
}

export async function connectQueueStore({
    uri = process.env.MONGODB_URI,
    databaseName = process.env.MONGODB_DATABASE || 'musicfr',
    MongoClientClass = MongoClient
} = {}) {
    if (!uri) return null;

    const client = new MongoClientClass(uri, {
        appName: 'MusicFR-Yapin',
        serverSelectionTimeoutMS: 10_000
    });

    try {
        await client.connect();
        const store = createQueueStore(client, databaseName);
        await store.initialize();
        return store;
    } catch (error) {
        await client.close();
        throw new Error('Could not initialize MongoDB queue persistence. Check MONGODB_URI and database access.', { cause: error });
    }
}
