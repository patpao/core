import { rvmMessageBus, ConsoleMessage } from '../rvm/rvm_message_bus';
import { System } from '../api/system';
import { setTimeout } from 'timers';
/**
 * Interface for [sendToRVM] method
 */
interface SendToRVMOpts {
    topic: 'application' | 'system';
    action: string;
    sourceUrl?: string;
    data?: any;
    runtimeVersion?: string;
    payload?: any;
}

// 1 MB
const maxBytes: number = 1000000;

let consoleMessageQueue: ConsoleMessage[] = [];
let isFlushScheduled: boolean = false;
let totalBytes: number = 0;
let consoleMessageTimer: NodeJS.Timer = null;
let heartbeatTimer: NodeJS.Timer = null;

function flushConsoleMessageQueue(): void {
    totalBytes = 0;
    isFlushScheduled = false;

    if (consoleMessageQueue.length <= 0) {
        return;
    }

    const obj: SendToRVMOpts = {
        topic: 'application',
        action: 'application-log',
        sourceUrl: '', // The actual sourceUrl's are contained in the payload
        runtimeVersion: System.getVersion(),
        payload: {
            messages: JSON.parse(JSON.stringify(consoleMessageQueue))
        }
    };

    consoleMessageQueue = [];
    sendToRVM(obj, true);
}

function sendRVMHeartbeat() {
    const obj: SendToRVMOpts = {
        topic: 'system',
        action: 'heartbeat',
        sourceUrl: '',
        runtimeVersion: System.getVersion()
    };

    sendToRVM(obj);
}

export function startRVMHeartbeatTimer(interval: number) {
    if (heartbeatTimer) {
        return;
    }
    if (!interval) {
        // Default interval to 5sec
        interval = 5000;
    }

    heartbeatTimer = setInterval(sendRVMHeartbeat, interval);
}

export function stopRVMHeartbeatTimer() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

export function addConsoleMessageToRVMMessageQueue(consoleMessage: ConsoleMessage): void {
    consoleMessageQueue.push(consoleMessage);

    const byteLength = Buffer.byteLength(consoleMessage.message, 'utf8');
    totalBytes += byteLength;

    // If we have exceeded the byte threshold for messages, flush the queue immediately
    if (totalBytes >= maxBytes) {
        if (consoleMessageTimer !== null) {
            clearTimeout(consoleMessageTimer);
            consoleMessageTimer = null;
        }

        flushConsoleMessageQueue();

    // Otherwise if no timer already set, set one to flush the queue in 10s
    } else if (!isFlushScheduled) {
        isFlushScheduled = true;
        consoleMessageTimer = setTimeout(flushConsoleMessageQueue, 10000);
    }
}

/**
 * Helper that uses RVM bus to send and receive payloads to/from RVM
 */
export function sendToRVM(opts: SendToRVMOpts, maskPayload?: boolean): Promise<any> {
    return new Promise((resolve, reject) => {

        // Make sure there is a connection with RVM
        if (!rvmMessageBus) {
            return reject(new Error('Connection with RVM is not established'));
        }

        const messageSent = rvmMessageBus.publish(Object.assign({timeToLive: 1000}, opts), (rvmResponse: any) => {

            // Don't do anything here because the message wasn't sent successfully to RVM
            // and we already sent error callback to the client
            if (!messageSent) {
                return;
            }

            // Not standard response
            if (typeof rvmResponse !== 'object') {
                return resolve(rvmResponse);
            }

            // Expired communication (waited to long to get the response)
            if (rvmResponse.hasOwnProperty('time-to-live-expiration')) {
                return reject(new Error('Unable to receive RVM response in a reasonable amount of time'));
            }

            // Communication error
            if (rvmResponse.success === false) {
                return reject(new Error(rvmResponse.error));
            }

            // Action execution error
            if (rvmResponse.payload && rvmResponse.payload.status === false) {
                return reject(new Error(rvmResponse.payload.error));
            }

            // Prepare a clean response for the user
            let payload = Object.assign({}, rvmResponse.payload);
            delete payload.action;
            delete payload.status;
            delete payload.error;
            if (Object.keys(payload).length === 0) {
                payload = undefined;
            }

            resolve(payload);

        }, maskPayload);

        if (!messageSent) {
            reject(new Error('Failed to send a message to the RVM'));
        }
    });
}
