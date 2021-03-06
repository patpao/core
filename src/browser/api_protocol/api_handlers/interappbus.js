/*
Copyright 2017 OpenFin Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
let apiProtocolBase = require('./api_protocol_base.js');
var InterApplicationBus = require('../../api/interappbus.js').InterApplicationBus;
import ofEvents from '../../of_events';
import route from '../../../common/route';

function InterApplicationBusApiHandler() {

    var subScriptionTypes = {
            MESSAGE: 1,
            SUB_ADDED: 2,
            SUB_REMOVED: 3
        },
        successAck = {
            success: true
        },
        interAppBusExternalApiMap = {
            'publish-message': publishMessage,
            'send-message': sendMessage,
            'subscribe': subscribe,
            'unsubscribe': unsubscribe,
            'subscriber-added': subscriberAdded,
            'subscriber-removed': subscriberRemoved
        };

    apiProtocolBase.registerActionMap(interAppBusExternalApiMap);

    function unsubscribe(identity, message, ack) {

        let payload = message.payload;
        let topic = payload.topic;
        let sourceUuid = payload.sourceUuid;
        let sourceWindowName = payload.sourceWindowName || '';

        apiProtocolBase.removeSubscription(identity, topic, identity.uuid, sourceUuid, sourceWindowName, subScriptionTypes.MESSAGE);
        ack(successAck);
    }

    function subscribe(identity, message, ack) {
        // let message = JSON.parse(JSON.stringify(rawMessage));
        let payload = message.payload;
        let topic = payload.topic;
        let sourceUuid = payload.sourceUuid;
        let sourceWindowName = payload.sourceWindowName || '';
        let {
            messageKey: subscribedMessageKey
        } = payload;

        let subscriptionCallback = function(payload) {
            let {
                messageKey: sentMessageKey
            } = payload;

            var command = {
                action: 'process-message',
                payload
            };

            // old subscribing to new
            if (!subscribedMessageKey && (sentMessageKey === 'messageString')) {
                command.payload.message = JSON.parse(payload[sentMessageKey]);
            }

            apiProtocolBase.sendToIdentity(identity, command);
        };

        const subscriptionArgs = [
            identity,
            topic,
            identity.uuid,
            sourceUuid,
            sourceWindowName,
            subScriptionTypes.MESSAGE
        ];

        if (apiProtocolBase.subscriptionExists(...subscriptionArgs)) {
            apiProtocolBase.uppSubscriptionRefCount(...subscriptionArgs);

        } else {

            const subscriptionObj = InterApplicationBus.subscribe(identity, payload, subscriptionCallback);

            apiProtocolBase.registerSubscription(subscriptionObj.unsubscribe, ...subscriptionArgs);

            ofEvents.once(route.window('unload', identity.uuid, identity.name, false), () => {
                apiProtocolBase.removeSubscription(...subscriptionArgs);
            });
        }

        ack(successAck);
    }


    function sendMessage(identity, message, ack) {
        InterApplicationBus.send(identity, message.payload);
        ack(successAck);
    }

    function publishMessage(identity, message, ack) {
        InterApplicationBus.publish(identity, message.payload);
        ack(successAck);
    }

    function subscriberAdded(identity, message, ack) {
        const {
            payload
        } = message;

        InterApplicationBus.raiseSubscriberEvent(ofEvents.subscriber.ADDED, payload);
        ack(successAck);
    }

    function subscriberRemoved(identity, message, ack) {
        const {
            payload
        } = message;

        InterApplicationBus.raiseSubscriberEvent(ofEvents.subscriber.REMOVED, payload);
        ack(successAck);
    }

    function initSubscriptionListeners(connectionIdentity) {
        var iabIdentity = {
            name: connectionIdentity.uuid,
            uuid: connectionIdentity.uuid
        };
        let subAddedSubObj, subRemovedSubObj;

        subAddedSubObj = InterApplicationBus.subscriberAdded(iabIdentity, function(subscriber) {

            let {
                directMsg
            } = subscriber;
            let directedToId = directMsg === connectionIdentity.name;

            if (directMsg) {
                if (directedToId) {
                    sendSubscriberEvent(connectionIdentity, subscriber, ofEvents.subscriber.ADDED);
                }

                // else msg not directed at this identity, dont send it

            } else {
                sendSubscriberEvent(connectionIdentity, subscriber, ofEvents.subscriber.ADDED);
            }
        });

        subRemovedSubObj = InterApplicationBus.subscriberRemoved(iabIdentity, function(subscriber = {}) {
            let {
                directMsg
            } = subscriber;
            let directedToId = directMsg === connectionIdentity.name;

            if (directMsg) {
                if (directedToId) {
                    sendSubscriberEvent(connectionIdentity, subscriber, ofEvents.subscriber.REMOVED);
                }

                // else msg not directed at this identity, dont send it

            } else {
                sendSubscriberEvent(connectionIdentity, subscriber, ofEvents.subscriber.REMOVED);
            }

        });

        apiProtocolBase.registerSubscription(subAddedSubObj.unsubscribe,
            iabIdentity,
            iabIdentity.uuid,
            iabIdentity.name,
            subScriptionTypes.SUB_ADDED);

        apiProtocolBase.registerSubscription(subRemovedSubObj.unsubscribe,
            iabIdentity,
            iabIdentity.uuid,
            iabIdentity.name,
            subScriptionTypes.SUB_REMOVED);
    }


    // As per 5.0 we blast out the subscriber-added and the subscriber-removed
    // envents. The following 2 hooks ensure that we continue to blast these out
    // for both external connections and js apps
    ofEvents.on(route.window('init-subscription-listeners'), (identity) => {
        initSubscriptionListeners(identity);
    });

    apiProtocolBase.onClientAuthenticated(initSubscriptionListeners);

    function sendSubscriberEvent(identity, subscriber, action) {
        var subscriberAdded = {
            action: action,
            payload: {
                senderName: subscriber.senderName,
                senderUuid: subscriber.senderUuid,
                targetName: subscriber.name,
                topic: subscriber.topic,
                uuid: subscriber.uuid
            }
        };
        apiProtocolBase.sendToIdentity(identity, subscriberAdded);
    }

} // end InterApplicationBusApiHandler

module.exports.InterApplicationBusApiHandler = InterApplicationBusApiHandler;
