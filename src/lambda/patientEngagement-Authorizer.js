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
var password = "";

exports.handler = async (event, context, callback) => {
    var params = {
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
    var isAuthorized = false;
    if (password == "") {
      isAuthorized = false;
    } else {
      isAuthorized = (event['headers']['authorization'] == password);
    }
   
    return {
        "isAuthorized": isAuthorized
    }     
}; 

function setResponse (data, callback) {
    data = JSON.stringify(data);
    data = JSON.parse(data);
    console.log (data);
    return data;   
}
