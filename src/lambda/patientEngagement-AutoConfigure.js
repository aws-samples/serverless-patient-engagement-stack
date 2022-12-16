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
var sns = new AWS.SNS();
var connect = new AWS.Connect();
var customerprofiles = new AWS.CustomerProfiles();

var connectInstanceId = "NOT_SET";
var connectSymKey = "NOT_SET"
var hrsOpsId = "NOT_SET";
var password = "NOT_SET";

exports.handler = async (event, context, callback) => {
    var params = {
      Name: '/ptf/connect/v1/ConnectInstanceId', /* required */
      WithDecryption: true
    };
    var result = ssm.getParameter(params, function(err, data) {
                                            if (err) console.log(err, err.stack); // an error occurred
                                            else     console.log(data);           // successful response
                                          }).promise();
    var ssmResponse = setResponse (await result, callback);
    connectInstanceId = getIDPart (ssmResponse.Parameter.Value);
    console.log ("Connect Instance ID: " + connectInstanceId);
    

    if (connectInstanceId == "NOT_SET") {
      console.log ("Instance not available. Please check the Amazon connect instance creation. Exiting...");
      process.exit();
    }
    
    params = {
      Name: '/ptf/connect/admin/password', /* required */
      WithDecryption: true
    };
    var result = ssm.getParameter(params, function(err, data) {
                                            if (err) console.log(err, err.stack); // an error occurred
                                            else     console.log(data);           // successful response
                                          }).promise();
    var ssmResponse = setResponse (await result, callback);
    password = ssmResponse.Parameter.Value;
    console.log ("Connect Admin password: " + password);
    

    if (password == "NOT_SET") {
      console.log ("Connect Admin Password not provided while provisioning connect instance. Exiting...");
      process.exit();
    }    
    
    // List the HoursOfOperations associated with Instance Id and get id that we want
    var paramsListHrsOps = {
      InstanceId: connectInstanceId /* required */
    };
    result = connect.listHoursOfOperations(paramsListHrsOps, function(err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      else     console.log(data);           // successful response
    }).promise();
    var listHrsOpsRes = setResponse (await result, callback);
    hrsOpsId = getIDPart (listHrsOpsRes.HoursOfOperationSummaryList[0].Arn);
    console.log ("hrsOpsId: " + hrsOpsId);

    // Get Phone number details
    var paramsPhone = {
      InstanceId: connectInstanceId, /* required */
      PhoneNumberCountryCodes: [
        'US'
        /* more items */
      ],
      PhoneNumberTypes: [
        'TOLL_FREE',
        /* more items */
      ]
    };
    result = connect.listPhoneNumbers(paramsPhone, function(err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      else     console.log(data);           // successful response
    }).promise();    
    var listPhoneNumberRes = setResponse (await result, callback);
    var phoneNumber = listPhoneNumberRes.PhoneNumberSummaryList[0].PhoneNumber;
    console.log ("phoneNumber: " + phoneNumber);
    
    // Get Basic Queue details
    // List queues and pick the first item
    var paramsListQueues = {
      InstanceId: connectInstanceId /* required */
    };
    result = connect.listQueues(paramsListQueues, function(err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      else     console.log(data);           // successful response
    }).promise();
    var listQueueRes = setResponse (await result, callback);
    var queueArn = listQueueRes.QueueSummaryList[0].Arn;
    var queueId = getIDPart (listQueueRes.QueueSummaryList[0].Arn);
    console.log ("phoneNumber: " + phoneNumber);   
  
    // Get Routing Profile details
    var params = {
      InstanceId: connectInstanceId /* required */
    };
    result = connect.listRoutingProfiles(params, function(err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      else     console.log(data);           // successful response
    }).promise();  
    // Extract Routing Profile Id
    var listRoutingProfRes = setResponse (await result, callback);
    var routingProfileId = getIDPart (listRoutingProfRes.RoutingProfileSummaryList[0].Arn);
    console.log ("routingProfileId: " + routingProfileId);   
  
    // Get the list of security profile and choose admin's profile
    var params = {
      InstanceId: connectInstanceId /* required */
    };
    var result = connect.listSecurityProfiles(params, function(err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      else     console.log(data);           // successful response
    }).promise();
    // Extract Admin Profile Id
    var listSecProfileRes = setResponse (await result, callback);
    var secProfileId = "NOT_SET";
    listSecProfileRes.SecurityProfileSummaryList.forEach((record) => {
      var name = record.Name;
      if (name === 'Admin') {
        secProfileId = getIDPart (record.Arn);
      }
    });
    console.log ("secProfileId: " + secProfileId); 

    //List contact flow, if already exists, do not create new one
    var params = {
      InstanceId: connectInstanceId, /* required */
      ContactFlowTypes: [
        'CONTACT_FLOW',
        /* more items */
      ]
    };
    result = connect.listContactFlows(params, function(err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      else     console.log(data);           // successful response
    }).promise();    
    var listContactFlowRes = setResponse (await result, callback);
    console.log ("lisContactFlowRes: " + listContactFlowRes); 
    var bContactFlowExists = false;
    listContactFlowRes.ContactFlowSummaryList.forEach((record) => {
      var name = record.Name;
      if (name === 'PTF Contact Flow') {
        bContactFlowExists = true;
      }
    });
    if (!bContactFlowExists) {
      // Get contact flow content from environment variable, replace queue id with this connect instance specific one.
      var contactFlowContent = createContactFlowContent (process.env.CONTACT_FLOW, queueArn);
      console.log ("contact flow content >> " + JSON.stringify(contactFlowContent));     
             
      params = {
        Content: JSON.stringify(contactFlowContent), /* required */
        InstanceId: connectInstanceId, /* required */
        Name: 'PTF Contact Flow', /* required */
        Type: 'CONTACT_FLOW', /* required */
        Description: 'Contact Flow created for Patient Followup',
        Tags: {
          'Purpose': 'Demo'
          /* '<TagKey>': ... */
        }
      };
      
      result = connect.createContactFlow(params, function(err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else     console.log(data);           // successful response
      }).promise();           
      var contactFlowRes = setResponse (await result, callback);
      console.log ("contactFlowRes: " + JSON.stringify(contactFlowRes)); 
      var contactFlowId = contactFlowRes.ContactFlowId;
      console.log ("contactFlowId: " + contactFlowId);
      
      params = {
        Name: '/ptf/connect/v1/ContactFlowId', /* required */
        Type: 'String',
        Overwrite: true,
        Value: contactFlowId
      };
      result = ssm.putParameter(params, function(err, data) {
                                              if (err) console.log(err, err.stack); // an error occurred
                                              else     console.log(data);           // successful response
                                            }).promise();
      ssmResponse = setResponse (await result, callback);
      console.log ("ssmResponse: " + JSON.stringify(ssmResponse)); 
    }

    params = {
      InstanceId: connectInstanceId /* required */
    };
    result = connect.listUsers(params, function(err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      else     console.log(data);           // successful response
    }).promise();
    var listUsersRes = setResponse (await result, callback);
    console.log ("listUsersRes: " + JSON.stringify(listUsersRes)); 
    var userName = "";
    if (typeof listUsersRes.UserSummaryList[0] !== 'undefined') {
      userName = getIDPart (listUsersRes.UserSummaryList[0].Username);
    }
    // Do not create the user if already exists!
    if (userName != process.env.CONNECT_ADMIN_USER) {
        // Create User - Provide routing profile id here as param
        var paramsUser = {
        InstanceId: connectInstanceId, /* required */
        PhoneConfig: { /* required */
          PhoneType: 'SOFT_PHONE' /* required */
        },
        RoutingProfileId: routingProfileId, /* required */
        SecurityProfileIds: [ /* required */
          secProfileId
          /* more items */
        ],
        Username: process.env.CONNECT_ADMIN_USER, /* required */
        IdentityInfo: {
          Email: process.env.CONNECT_ADMIN_EMAIL,
          FirstName: process.env.CONNECT_ADMIN_FNAME,
          LastName: process.env.CONNECT_ADMIN_LNAME
        },
        Password: password
      };
      
      
      result = connect.createUser(paramsUser, function(err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else     console.log(data);           // successful response
      }).promise();     
      var userCreationRes = setResponse (await result, callback);
      console.log ("User creation response: " + JSON.stringify(userCreationRes));     
    }
    

    params = {
      Message: 'Configuration completed...', /* required */
      MessageAttributes: {
        'action': {
          DataType: 'String', /* required */
          StringValue: 'status'
        },
      },
      Subject: 'Dear patron, Patient Care Service configuration complete ...',
      TopicArn: process.env.TOPIC_ARN
    };
    
    result = sns.publish(params, function(err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      else     console.log(data);           // successful response
    }).promise(); 
    var snsRes = setResponse (await result, callback);
    console.log ("SNS Response: " + JSON.stringify(snsRes)); 
    
    return snsRes;
}; 

function createContactFlowContent (content, queueArn) {
  content = JSON.parse(content);
  content.Actions[1].Parameters.QueueId = queueArn;
  var actionMetadataId = content.Actions[1].Identifier;
  console.log ("actionMetadataId: " + actionMetadataId);
  content.Metadata.ActionMetadata [actionMetadataId].queue.id= queueArn;
  return content;  
}


function setResponse (data, callback) {
    data = JSON.stringify(data);
    data = JSON.parse(data);
    console.log (data);
    return data;   
}

function getIDPart (str) {
  return str.split('/').pop();
}

