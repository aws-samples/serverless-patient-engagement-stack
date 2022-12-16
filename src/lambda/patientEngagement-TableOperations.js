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
let response = {
    statusCode: "400",
    headers: {
        "Content-Type": "application/json"
    },
    body: '{ "Error":"Bad Request"}'
}; 

exports.handler = async (event, context, callback) => {
    /*
        1/ Extract HTTP method
        2/ Put Case statement
        3/ POST - Create operation | DELETE - Delete operation | GET - Retrieve operartion | UPDATE - Update operation
    */
    var operation = event.requestContext.http.method;

    console.log ("Event: " + JSON.stringify(event));
      switch(operation){
        case 'DELETE': {
          console.log (JSON.stringify(event.pathParameters));
          response = await deleteItem (event.pathParameters);
          console.log (response);
          break;
        }
        case 'POST': {
          var itemData = JSON.parse(event.body);
          console.log (itemData.id + "," + itemData.protocolID + "," + itemData.content + "," + itemData.relativeTime + "," + itemData.type +","+ itemData.recurringFrequencyInDays +","+ itemData.recurring);
          response = await createItem (itemData, event.pathParameters);
          console.log (response);
          break;
        }
        case 'GET': {
          console.log (JSON.stringify(event.pathParameters));
          var length = Object.keys(event.pathParameters).length;
          console.log ("Path parameter array lenght is >> " + length);
          if (length != 0) {
            if (length == 1) response = await getItems (event.pathParameters);
            if (length == 2) response = await getItem (event.pathParameters);
            console.log (response);
          }
          break;
        }        
        default:
          console.log('Unhandled Event: ' + JSON.stringify(itemData));
          break;
      }  
      return response; 
};

let createItem = async (itemData, eventParameters) => {
  let responseBody ='{}';
  let statusCode = 400;
  console.log('Item content' + itemData.content);
  const { tableName } = eventParameters;
  let params = {
        TableName: tableName,
        Item: itemData
    };
    try {
        var data = await dynamo.put(params).promise();
        responseBody = JSON.stringify(data);
        console.log ("response body: " + responseBody);
        statusCode = 201;
    } catch (err) {
        responseBody = "Unable to put Item: ${err}";
        statusCode = 403;
    }   
    
    response = {
        statusCode: statusCode,
        headers: {
            "Content-Type": "application/json"
        },
        body: responseBody
    };     
    return response;
};

let deleteItem = async (eventParameters) => {
  if (eventParameters == {}) {
    return null;
  }
  let responseBody ='{}';
  let statusCode = 400;
  const { tableName, id } = eventParameters;
  console.log('Item Id: ' + id);

  let params = {
        TableName: tableName,
        Key: {
            id: id
        }
    };
    try {
        var data = await dynamo.delete (params).promise();
        responseBody = JSON.stringify(data);
        console.log ("response body: " + responseBody);
        statusCode = 204;
    } catch (err) {
        responseBody = "Unable to delete Item: ${err}";
        statusCode = 403;
    }   
    
    response = {
        statusCode: statusCode,
        headers: {
            "Content-Type": "application/json"
        },
        body: responseBody
    };     
    return response;
};

let getItems = async (eventParameters) => {
  if (eventParameters == {}) {
    return null;
  }
  let responseBody ='{}';
  let statusCode = 400;
  const { tableName } = eventParameters;
  console.log('tableName: ' + tableName);

    let params = {
        TableName: tableName
    };
    try {
        var data = await dynamo.scan (params).promise();
        responseBody = JSON.stringify(data);
        console.log ("response body: " + responseBody);
        statusCode = 200;
    } catch (err) {
        responseBody = "Unable to fetch Items: ${err}";
        statusCode = 403;
    }   
    
    response = {
        statusCode: statusCode,
        headers: {
            "Content-Type": "application/json"
        },
        body: responseBody
    };     
    return response;
};

let getItem = async (eventParameters) => {
  if (eventParameters == {}) {
    return null;
  }
  let responseBody ='{}';
  let statusCode = 400;
  const { key, tableName } = eventParameters;
  console.log('tableName: ' + tableName + " and key: " + key);

    let params = {
        TableName: tableName,
        Key:  {
          id: key
        }
    };
    try {
        var data = await dynamo.get (params).promise();
        responseBody = JSON.stringify(data);
        console.log ("response body: " + responseBody);
        statusCode = 200;
    } catch (err) {
        responseBody = "Unable to get Item - "+ JSON.stringify(params) +": ${err}";
        statusCode = 403;
    }   
    
    response = {
        statusCode: statusCode,
        headers: {
            "Content-Type": "application/json"
        },
        body: responseBody
    };     
    return response;
};
