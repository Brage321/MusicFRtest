import test from 'node:test';
import assert from 'node:assert/strict';
import { connectQueueStore } from '../queue-store.js';

class FakeCollection {
    documents = new Map();
    index = null;

    async createIndex(fields, options) {
        this.index = { fields, options };
    }

    find() {
        return { toArray: async () => [...this.documents.values()] };
    }

    async replaceOne(filter, document) {
        this.documents.set(filter.serverId, structuredClone(document));
    }

    async deleteOne(filter) {
        this.documents.delete(filter.serverId);
    }
}

class FakeClient {
    static instance;

    constructor(uri, options) {
        this.uri = uri;
        this.options = options;
        this.collection = new FakeCollection();
        this.closed = false;
        FakeClient.instance = this;
    }

    async connect() {}

    db(name) {
        this.databaseName = name;
        return { collection: () => this.collection };
    }

    async close() {
        this.closed = true;
    }
}

function state(overrides = {}) {
    return {
        voiceChannelId: 'voice-1',
        textChannelId: 'text-1',
        current: {
            id: 'audius-current',
            title: 'Current track',
            artist: 'Artist',
            duration: 210,
            requestedBy: 'Listener'
        },
        queue: [{ id: 'audius-next', title: 'Next track', artist: 'Other artist' }],
        loopMode: 'queue',
        volume: 65,
        stopping: false,
        ...overrides
    };
}

test('MongoDB stays optional when no connection URI is configured', async () => {
    const store = await connectQueueStore({ uri: '', MongoClientClass: FakeClient });
    assert.equal(store, null);
    assert.equal(FakeClient.instance, undefined);
});

test('persists and restores a queue, resuming the interrupted current track first', async () => {
    const store = await connectQueueStore({
        uri: 'mongodb://localhost:27017',
        databaseName: 'musicfr_test',
        MongoClientClass: FakeClient
    });
    const client = FakeClient.instance;

    assert.equal(client.uri, 'mongodb://localhost:27017');
    assert.equal(client.options.appName, 'MusicFR-Yapin');
    assert.equal(client.databaseName, 'musicfr_test');
    assert.deepEqual(client.collection.index, {
        fields: { serverId: 1 },
        options: { unique: true }
    });

    await store.save('server-1', state());
    const [restored] = await store.loadAll();
    assert.equal(restored.serverId, 'server-1');
    assert.deepEqual(restored.state.queue.map((track) => track.id), ['audius-current', 'audius-next']);
    assert.equal(restored.state.current, null);
    assert.equal(restored.state.volume, 65);
    assert.equal(restored.state.loopMode, 'queue');
    assert.equal(restored.state.paused, false);

    await store.close();
    assert.equal(client.closed, true);
});

test('removes stopped and empty queues instead of restoring them later', async () => {
    const store = await connectQueueStore({
        uri: 'mongodb://localhost:27017',
        MongoClientClass: FakeClient
    });

    await store.save('server-1', state());
    await store.save('server-1', state({ stopping: true }));
    assert.equal(FakeClient.instance.collection.documents.has('server-1'), false);

    await store.save('server-2', state({ current: null, queue: [] }));
    assert.equal(FakeClient.instance.collection.documents.has('server-2'), false);
    await store.close();
});

test('reports malformed persisted records instead of restoring incomplete sessions', async () => {
    const store = await connectQueueStore({
        uri: 'mongodb://localhost:27017',
        MongoClientClass: FakeClient
    });
    FakeClient.instance.collection.documents.set('bad-server', {
        serverId: 'bad-server',
        voiceChannelId: 'voice-1',
        textChannelId: 'text-1',
        queue: [{ id: 'missing-title' }]
    });

    await assert.rejects(store.loadAll(), /queue track without a valid id and title/);
    await store.close();
});
