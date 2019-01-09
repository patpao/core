import { rvmMessageBus, ConsoleMessage, RvmBulkMessagePart } from '../rvm/rvm_message_bus';
import { System } from '../api/system';
import { setTimeout } from 'timers';
/**
 * Interface for [sendToRVM] method
 */
interface SendToRVMOpts {
    topic: 'application';
    action: string;
    sourceUrl?: string;
    data?: any;
    runtimeVersion?: string;
    payload?: any;
}

const maxBytes: number = 1000000;  // 1 MB
const defaultFlushInterval: number = 10000;  // 10 seconds
const minRvmHeartbeatVersion: string = '4.7.0.0';

let flushInterval: number = defaultFlushInterval;
let consoleMessageQueue: RvmBulkMessagePart[] = [];
let totalBytes: number = 0;
let timer: NodeJS.Timer = null;
let shouldSendHeartbeatMessage: boolean = false;

function flushConsoleMessageQueue(): void {
    totalBytes = 0;

    // Only send heartbeat for RVM's >= 4.7 to avoid older RVM's spamming the logs with
    // "invalid message"
    if (shouldSendHeartbeatMessage) {
        consoleMessageQueue.push({
            type: 'heartbeat-message'
        });
    }

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

export function addConsoleMessageToRVMMessageQueue(consoleMessage: ConsoleMessage): void {
    consoleMessageQueue.push(consoleMessage);

    const byteLength = Buffer.byteLength(consoleMessage.message, 'utf8');
    totalBytes += byteLength;

    // If we have exceeded the byte threshold for messages, flush the queue immediately
    if (totalBytes >= maxBytes) {
        if (timer !== null) {
            clearInterval(timer);
        }

        flushConsoleMessageQueue();

        timer = setInterval(flushConsoleMessageQueue, flushInterval);
    }
}

export function startRVMMessageTimer(interval?:  number, rvmVersion? : string) {
    if (timer) {
        return;
    }

    if (interval) {
        flushInterval = interval;
    }

    if (rvmVersion && rvmVersion >= minRvmHeartbeatVersion) {
        shouldSendHeartbeatMessage = true;
    }

    timer = setInterval(flushConsoleMessageQueue, flushInterval);
}

export function stopRVMMessageTimer() {
    if (timer) {
        clearInterval(timer);
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
