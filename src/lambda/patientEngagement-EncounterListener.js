/*
MIT License

Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

'use strict';
var AWS = require("aws-sdk");
const { randomUUID } = require('crypto');
var sns = new AWS.SNS();
var connect = new AWS.Connect();
var dynamo = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event, context, callback) => {
    console.info("EVENT\n" + JSON.stringify(event, null, 2));
    let userId, when, protocolId, user, protocol, events, streamEvent, streamType,isProcessingOn;
    
    event.Records.forEach((record) => {
      if (record.eventName == 'INSERT' && record.dynamodb.StreamViewType != 'KEYS_ONLY') {
          isProcessingOn=true
          streamEvent=record.eventName;
          streamType=record.dynamodb.StreamViewType;
          protocolId = record.dynamodb.NewImage.protocolId.S;
          when = record.dynamodb.NewImage.startedOn.S;
          userId = record.dynamodb.NewImage.userId.S;
      } else {
        isProcessingOn=false;
      }
    });
    
    console.log ("Stream Type is: " + streamType);
    if (isProcessingOn == true && streamEvent == 'INSERT' && streamType != 'KEYS_ONLY') {
      //Fetch User
      user = await dynamo.get({
              TableName: process.env.TBL_PATIENT,
              Key: {
                id: userId
              }
            }).promise();
      
      //Fetch Protocol
      protocol = await dynamo.get({
              TableName: process.env.TBL_PROTOCOL,
              Key: {
                id: protocolId
              }
            }).promise();
      protocol = protocol.Item;
      
      //Fetch Events
      events = await dynamo.query({
              TableName: process.env.TBL_EVENT,
              IndexName: "byProtocol",
              KeyConditionExpression: 'protocolID = :protoID',
              ExpressionAttributeValues: {
                ':protoID': protocolId
              }
            }).promise();
            
      //Construct currentSchedule Events for the User and Given Protocol
      const protocolExpiresIn = protocol.expireInDays;
      console.log ("Protocol expires in days: " + protocolExpiresIn);
      console.info("EVENTS\n" + JSON.stringify(events.Items[2], null, 2));
      
      events.Items.forEach((record) => {
          generateItems(protocolExpiresIn, record.recurringFrequencyInDays, when, userId, user, protocol, record);  
      });
      
      console.log('Event processed');
      callback(null, `Successfully processed ${event.Records.length} records.`);
    }
}; 

function generateItems(protocolExpiresIn, eventRecurringFrequencyInDays, when, userId, user, protocol, record){
  let items = [];
  console.log(protocolExpiresIn + '-' + eventRecurringFrequencyInDays);
  if(protocolExpiresIn > 0 && eventRecurringFrequencyInDays > 0){
    items = loopBuildCurrentItems(Math.round(protocolExpiresIn/eventRecurringFrequencyInDays), eventRecurringFrequencyInDays, when, userId, user, protocol, record,protocolExpiresIn);
  }
  if(protocolExpiresIn > 0 && eventRecurringFrequencyInDays == 0){
    items = loopBuildCurrentItems(Math.round(1), eventRecurringFrequencyInDays, when, userId, user, protocol, record, protocolExpiresIn);
  }
  return items;
}

async function loopBuildCurrentItems(loopCount, daysOffset, when, userId, user, protocol, record, protocolExpiresIn){
  let items = [];
  let startedOn = new Date(when);
  let userItem = user.Item;
  let eventTime = addMinutes(startedOn, record.relativeTime);
  let protocolExpiresOn = getProtocolExpiryDate(startedOn, record.relativeTime, protocolExpiresIn);

  console.log('Current Schedule Events number for the event '+record.id+' :: ' + loopCount);
  for(let i=0; i < loopCount; i++){
    let newEventTime = addDays(eventTime, i * daysOffset);
    console.log ("protocolExpiresOn: " + protocolExpiresOn.getTime() + " and newEventTime: " + newEventTime.getTime());

    if (protocolExpiresOn.getTime() > newEventTime.getTime()) {
      let currentScheduleItem = {
        PutRequest: {
          Item: {
            id: randomUUID(),
            userId: userId,
            userName: userItem.name,
            eventId:record.id,  
            eventDate: getEventDateFormat(newEventTime),
            eventTime: new Date(newEventTime).toISOString(),
            content: record.content,
            eventType: record.type,
            eventCode: generateCode(),
            retryCount: 0,
            retryTime: null,
            emailId: userItem.emailId,
            phoneNumber: userItem.phoneNumber,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }
      };      
      console.log ("Run #" + i);
      console.log ('item representation: ' + JSON.stringify(currentScheduleItem) + '\n'); 
      items.push(currentScheduleItem);
    }
  }
  if(items.length > 0){
    const chunkSize = 10;
    for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        var params = {};
        params.RequestItems = {};
        params.RequestItems[process.env.TBL_CURRENTSCHEDULE] = chunk;
        //Batch Update
        let currentScheduleItemsResp = await dynamo.batchWrite(params).promise();
        console.log(JSON.stringify(currentScheduleItemsResp));  
    }
  }
  return items;
}

function getEventDateFormat(eventDate){
  var date = new Date(eventDate);
  var minute = date.getMinutes().zeroPad(2);
  var hour = date.getHours().zeroPad(2);
  var day = date.getDate().zeroPad(2);
  var month = (date.getMonth() + 1).zeroPad(2);
  var year = date.getFullYear();
  var eventDate = year + '/' + month + '/'+ day + '-' + hour + ':' + minute;
  return eventDate;
}

Number.prototype.zeroPad = function(length) {
   length = length || 2; // defaults to 2 if no parameter is passed
   return (new Array(length).join('0')+this).slice(length*-1);
};


function addMinutes(date, minutes) {
  return new Date(date.getTime() + parseInt(minutes) * 60000);
}

function getProtocolExpiryDate(date, minutes, protocolExpiresIn) {
  return new Date(date.getTime() + parseInt(minutes) * 60*1000 + parseInt(protocolExpiresIn)*(24*60* 60*1000));
}

function addDays(date, days) {
  let newDate = new Date(date);
  newDate.setDate(date.getDate() + days);
  return newDate;
}
// Generate event code
function generateCode() {
    var numbers = '0123456789';
    let code = '';
    for (let i = 0; i < 4; i++ ) {
        code += numbers[Math.floor(Math.random() * 10)];
    }
    return code;
}
