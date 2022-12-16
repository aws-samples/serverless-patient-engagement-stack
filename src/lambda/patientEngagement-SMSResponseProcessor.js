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

const AWS = require('aws-sdk'); // Load the AWS SDK for Node.js
let dynamo = new AWS.DynamoDB.DocumentClient();  
let itemData = {};
itemData.tableName = process.env.TBL_EVENTRESPONSE;

exports.handler = async (event, context, callback) => {
    console.log (event.Records[0].Sns.Message);
    let msg = JSON.parse(event.Records[0].Sns.Message);
    itemData.fromNumber = msg.originationNumber;
    let messageBody = msg.messageBody;
    console.log ("messageBody is " + msg.messageBody);
    itemData.inboundMessageId = msg.inboundMessageId;
    const messageAttrArr = messageBody.split (" ");
    itemData.confirmationStatus = messageAttrArr[0].toUpperCase();
    itemData.eventCode=messageAttrArr[1];
    var data = await updateItem (itemData);
    console.log (data);
};

let updateItem = async (itemData) => {
  let responseBody ='{}';
  let params = {
        TableName: itemData.tableName,
        Key: { id : itemData.fromNumber+itemData.eventCode },
        UpdateExpression: "set confirmationStatus = :confirmationStatus, inboundMessageId = :inboundMessageId",
        ExpressionAttributeValues: {
            ':inboundMessageId': itemData.inboundMessageId,
            ':confirmationStatus' : itemData.confirmationStatus
       },
       ReturnValues:"UPDATED_NEW"
    };
    try {
        console.log (params);
        var data = await dynamo.update (params).promise();
        responseBody = JSON.stringify(data);
        console.log ("response body: " + responseBody);
    } catch (err) {
        responseBody = "Unable to put Item: " + err;
    }   
    return responseBody;
};
