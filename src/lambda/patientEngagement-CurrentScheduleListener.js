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
var ssm = new AWS.SSM();
var connect = new AWS.Connect();
var dynamo = new AWS.DynamoDB.DocumentClient();

// Amazon Connect configurations
let contactFlowId =  'undefined';
let instanceId =  'undefined';

// Amazon Pinpoint cofigurations
var originationNumber = process.env.ORIGINATION_NUMBER;
let applicationId = "undefined";
var messageType = "TRANSACTIONAL";
var pinpoint = new AWS.Pinpoint();

exports.handler = async (event, context, callback) => {
    let events;
    
    var params = {
      Name: '/ptf/connect/v1/ConnectInstanceId', /* required */
      WithDecryption: true
    };
    var result = ssm.getParameter(params, function(err, data) {
                                            if (err) console.log(err, err.stack); // an error occurred
                                            else     console.log(data);           // successful response
                                          }).promise();
    var ssmResponse = setResponse (await result, callback);
    instanceId = getIDPart (ssmResponse.Parameter.Value);
    console.log ("Connect Instance ID: " + instanceId);
    
    params = {
      Name: '/ptf/connect/v1/ContactFlowId', /* required */
      WithDecryption: true
    };    
    result = ssm.getParameter(params, function(err, data) {
                                            if (err) console.log(err, err.stack); // an error occurred
                                            else     console.log(data);           // successful response
                                          }).promise();
    ssmResponse = setResponse (await result, callback);
    contactFlowId = getIDPart (ssmResponse.Parameter.Value);
    console.log ("ContactFlowId: " + contactFlowId);
    
     params = {
      Name: '/ptf/pinpoint/v1/PinpointAppId', /* required */
      WithDecryption: true
    };    
    result = ssm.getParameter(params, function(err, data) {
                                            if (err) console.log(err, err.stack); // an error occurred
                                            else     console.log(data);           // successful response
                                          }).promise();
    ssmResponse = setResponse (await result, callback);
    applicationId = getIDPart (ssmResponse.Parameter.Value);
    console.log ("ApplicationId: " + applicationId);
    
    
    
    let today = getEventDateFormat(new Date());
    console.log('Query all events for this minute : ' + today);
    
    //Fetch Current Events
    events = await dynamo.query({
      TableName: process.env.TBL_CURRENTSCHEDULE,
      IndexName: "byEventDate",
      KeyConditionExpression: 'eventDate = :eventDate',
      ExpressionAttributeValues: {
        ':eventDate': today
      }
    }).promise();
    console.log('Fetched ' + events.Items.length + ' events for ' + today);
    
    events.Items.forEach((record) => {
      let who, when, what, eventCode;
      who = record.userName;
      when = record.eventTime;
      when = new Date().toISOString();
      eventCode = record.eventCode;
      what = record.content;
      
      let itemData = {};
      itemData.id = record.phoneNumber+eventCode;
      itemData.useName = who;
      itemData.phoneNumber = record.phoneNumber;
      itemData.userId = record.userId;
      itemData.emailId = record.emailId;
      itemData.eventDate = record.eventDate;
      itemData.inboundMessageId = null;
      itemData.confirmationStatus = "Awaited";
      
      let eventResParams = {
            TableName: process.env.TBL_EVENTRESPONSE,
            Item: itemData
      };       
      switch(record.eventType){
        case 'CALL':
          pushToAmazonConnectTasks(who, when, what);
          break;
        case 'SMS': {
            var smsMsg = what+"(Reply OK [code] to confirm or CANCEL [code] to cancel. Your code is " + eventCode +")";
            try {
                dynamo.put(eventResParams, function(err, data) {
                  if (err) console.log(err);
                  else console.log(data);
                }).promise();
            } catch (err) {
                console.log ("Unable to put Item: " + err);
            }   
            sendSMS(who, when, smsMsg, record.phoneNumber);
            break;
          }
        case 'EMAIL':
          sendEmail (what, record.emailId);
          break;
        default:
          console.log('Unhandled Event: ' + JSON.stringify(record));
          break;
      }
    });
}; 

let pushToAmazonConnectTasks = async (who, when, what) => {
  console.log('Scheduling call for ' + who);
  console.log('Time: ' + when);
  let taskParams = {
        ContactFlowId: contactFlowId,
        InstanceId: instanceId, 
        Name: "Call: " + who,
        Attributes: {
          userName: who,
          scheduledTime: when,
          talkingScript: JSON.stringify(what)
        }
    }
    console.info("Connect Task Params\n" + JSON.stringify(taskParams, null, 2));
    await connect.startTaskContact(taskParams, function(err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      else     console.log(data);           // successful response
    });
}

let sendSMS = async (who, when, what, phoneNumber) => {
  console.log('Sending SMS to ' + phoneNumber);
  // Specify the parameters to pass to the API.
  var params = {
    ApplicationId: applicationId,
    MessageRequest: {
      Addresses: {
        [phoneNumber]: {
          ChannelType: 'SMS'
        }
      },
      MessageConfiguration: {
        SMSMessage: {
          Body: what,
          MessageType: messageType
        }
      }
    }
  }
  console.info("SMS Params\n" + JSON.stringify(params, null, 2));
  var response = await pinpoint.sendMessages(params).promise();
  console.log('Resonse from Pinpoint $s', JSON.stringify(response));
}

let sendEmail = async (what, emailId) => {
  console.log('Sending Email to ' + emailId);
  // Specify the parameters to pass to the API.
  var charset = "UTF-8";
  var params = {
    ApplicationId: applicationId,
    MessageRequest: {
      Addresses: {
        [emailId]:{
          ChannelType: 'EMAIL'
        }
      },
      MessageConfiguration: {
        EmailMessage: {
          FromAddress: process.env.FROM_EMAIL,
          SimpleEmail: {
            Subject: {
              Charset: charset,
              Data: 'Event Notification from Patient Care Service'
            },
            HtmlPart: {
              Charset: charset,
              Data: what
            },
            TextPart: {
              Charset: charset,
              Data: what
            }
          }
        }
      }
    }
  };  
  
  console.info("Email Params\n" + JSON.stringify(params, null, 2));
  let responseBody ='{}';
  let statusCode = 400;
    try {
        var data = await pinpoint.sendMessages(params).promise();
        responseBody = JSON.stringify(data);
        console.log ("response body: " + responseBody);
        statusCode = 201;
    } catch (err) {
        responseBody = "Unable to put Item: ${err}";
        statusCode = 403;
    }  
    var response = {
        statusCode: statusCode,
        headers: {
            "Content-Type": "application/json"
        },
        body: responseBody
    };     
    return response;    
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

function setResponse (data, callback) {
    data = JSON.stringify(data);
    data = JSON.parse(data);
    console.log (data);
    return data;   
}

function getIDPart (str) {
  return str.split('/').pop();
}
