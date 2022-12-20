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

import * as cdk from 'aws-cdk-lib';
import * as cfninc from 'aws-cdk-lib/cloudformation-include';
import { Construct } from 'constructs';

export class PtfConnectStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // Read the parameter values from cdk.json to set them as environment variables within Lambda
    const parameters = scope.node.tryGetContext('parameters');
    
    let myParameters =  {
        "Region": parameters.REGION,
        "ConnectInstanceAlias" : parameters.CONNECT_INSTANCE_ALIAS,
        "ConnectDomainName" : parameters.CONNECT_DOMAIN_NAME,
        "ConnectDomainExpiryDays" : parameters.CONNECT_DOMAIN_EXPIRY_DAYS,
        "ConnectKeyPendingWindowInDays" : parameters.CONNECT_KEY_PENDINGWINDOWINDAYS,
        "AWSAccountId" : parameters.AWS_ACCOUNT_ID
      };
      
      console.log (myParameters);
      
      console.log ("myParameters: " + JSON.stringify(myParameters));
    
    const template = new cfninc.CfnInclude(this, 'Template', { 
      templateFile: './lib/ptf-connect-cft.json',
      parameters: {
        "Region": parameters.REGION,
        "ConnectInstanceAlias" : parameters.CONNECT_INSTANCE_ALIAS,
        "ConnectDomainName" : parameters.CONNECT_DOMAIN_NAME,
        "ConnectDomainExpiryDays" : parameters.CONNECT_DOMAIN_EXPIRY_DAYS,
        "ConnectKeyPendingWindowInDays" : parameters.CONNECT_KEY_PENDINGWINDOWINDAYS,
        "AWSAccountId" : parameters.AWS_ACCOUNT_ID
      }
    });
  }
}
