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

import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';

import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from '@aws-cdk/aws-apigatewayv2-alpha';
import { HttpLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from '@aws-cdk/aws-apigatewayv2-authorizers-alpha';

export class PtfAppStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // Read the parameter values from cdk.json to set them as environment variables within Lambda
    const parameters = scope.node.tryGetContext('parameters');
    
    // Provision DynamoDB tables
    // 👇 create Dynamodb table - CurrentSchedule
    var tblName = 'CurrentSchedule';
    const tblCurrenSchedule = new dynamodb.Table(this, id+"_"+tblName, {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {name: 'id', type: dynamodb.AttributeType.STRING},
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      tableName: tblName
    });

    // 👇 add global secondary index to CurrentSchedule table - byEventDate
    tblCurrenSchedule.addGlobalSecondaryIndex({
      indexName: 'byEventDate',
      partitionKey: {name: 'eventDate', type: dynamodb.AttributeType.STRING},
      projectionType: dynamodb.ProjectionType.ALL
    });

    tblName = 'Encounter';
    // 👇 create Dynamodb table Encounter
    const tblEncounterProps = {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {name: 'id', type: dynamodb.AttributeType.STRING},
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      pointInTimeRecovery: true,
      tableName: tblName
    };
    
    const tblEncounter = new dynamodb.Table(this, id+"_"+tblName, tblEncounterProps);

    tblName = 'Event';
    // 👇 create Dynamodb table - Event
    const tblEvent = new dynamodb.Table(this, id+"_"+tblName, {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {name: 'id', type: dynamodb.AttributeType.STRING},
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      tableName: tblName
    });

    // 👇 add global secondary index to Event table - byProtocol
    tblEvent.addGlobalSecondaryIndex({
      indexName: 'byProtocol',
      partitionKey: {name: 'protocolID', type: dynamodb.AttributeType.STRING},
      projectionType: dynamodb.ProjectionType.ALL
    });
    
    tblName = 'Protocol';
    // 👇 create Dynamodb table - Protocol
    const tblProtocol = new dynamodb.Table(this, id+"_"+tblName, {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {name: 'id', type: dynamodb.AttributeType.STRING},
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      tableName: tblName
    });
    
    tblName = 'User';
    // 👇 create Dynamodb table - User
    const tblUser = new dynamodb.Table(this, id+"_"+tblName, {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {name: 'id', type: dynamodb.AttributeType.STRING},
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      tableName: tblName
    });
    
    tblName = 'EventResponse';
    // 👇 create Dynamodb table - EventResponse
    const tblEventResponse = new dynamodb.Table(this, id+"_"+tblName, {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {name: 'id', type: dynamodb.AttributeType.STRING},
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      tableName: tblName
    }); 
    
    // 👇 add global secondary index to CurrentSchedule table - byPhoneNumber
    tblEventResponse.addGlobalSecondaryIndex({
      indexName: 'byPhoneNumber',
      partitionKey: {name: 'phoneNumber', type: dynamodb.AttributeType.STRING},
      projectionType: dynamodb.ProjectionType.ALL
    });   
    
    
    /*
     * Provision IAM policies
     * Provision IAM Roles, Attach policies
     * Provision Lambdas, Each lambda to have its own role
     * Setup EventBridge Rule and add target as Lambda
     * Provision DDB tables, enable stream, add listener lambda
     */
     
    // SimpleAuthorizer implemented as Lambda Authorizer for all HTTP API routes; expectes connect admin's password to be passed as Authorization header while invoking
    const lambdaSimpleAuthorizerPolicy = new iam.Policy(this, 'ptf-lambda-simpleAuthorizer-policy', {
        policyName: 'ptf-simpleAuthorizer-policy',
        statements: [
        new iam.PolicyStatement({
          actions: ['logs:CreateLogGroup'],
          resources: ['*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['arn:aws:logs:'+parameters.REGION+':'+parameters.AWS_ACCOUNT_ID+':log-group:/aws/lambda/patientEngagement-Authorizer:*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: [
                "ssm:GetParameters",
                "ssm:GetParameter"
            ],
          resources: [
                "arn:aws:ssm:*:"+parameters.AWS_ACCOUNT_ID+":parameter/*"
            ],
          effect: iam.Effect.ALLOW,
        })
      ],
    });

    const lambdaSimpleAuthorizerole = new iam.Role(this, 'ptf-simpleAuthorizer-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'lambdaSimpleAuthorizerRole',
      roleName: 'ptf-simpleAuthorizer-role'
    });
    lambdaSimpleAuthorizerPolicy.attachToRole (lambdaSimpleAuthorizerole);

    const lambdaSimpleAuthorizer = new lambda.Function(this, 'lambdaSimpleAuthorizerHandler', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'patientEngagement-Authorizer.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/lambda')),
      role: lambdaSimpleAuthorizerole,
      functionName: 'patientEngagement-SimpleAuthorizer'
    }); 

    // IAM Policy and Role setup for patientEngagement-encounterListener
    const lambdaEncounterListenerPolicy = new iam.Policy(this, 'ptf-lambda-encounterlistener-policy', {
        policyName: 'ptf-encounterlistener-policy',
        statements: [
        new iam.PolicyStatement({
          actions: ['logs:CreateLogGroup'],
          resources: ['*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['arn:aws:logs:'+parameters.REGION+':'+parameters.AWS_ACCOUNT_ID+':log-group:/aws/lambda/patientEngagement-EncounterListener:*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: [
                "dynamodb:GetRecords",
                "dynamodb:GetShardIterator",
                "dynamodb:DescribeStream",
                "dynamodb:ListStreams"
            ],
          resources: ["arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/Encounter/stream/*"],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: [
                "dynamodb:BatchGet*",
                "dynamodb:DescribeStream",
                "dynamodb:DescribeTable",
                "dynamodb:Get*",
                "dynamodb:Query",
                "dynamodb:Scan",
                "dynamodb:BatchWrite*",
                "dynamodb:PutItem"
            ],
          resources: [
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/CurrentSchedule",
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/User",
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/Event",
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/Protocol",
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/Encounter",
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/Event/index/byProtocol"
            ],
          effect: iam.Effect.ALLOW,
        })         
      ],
    }); 
    const lambdaEncounterListenerRole = new iam.Role(this, 'ptf-encounterlistener-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'lambdaEncounterListenerRole',
      roleName: 'ptf-encounterlistener-role'
    });
    lambdaEncounterListenerPolicy.attachToRole (lambdaEncounterListenerRole);
    

    const lambdaEncounterListener = new lambda.Function(this, 'lambdaEncounterListenerHandler', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'patientEngagement-EncounterListener.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/lambda')),
      role: lambdaEncounterListenerRole,
      functionName: 'patientEngagement-EncounterListener',
      environment: {
          "TBL_EVENT": parameters.TBL_EVENT,
          "TBL_PROTOCOL": parameters.TBL_PROTOCOL,
          "TBL_PATIENT": parameters.TBL_PATIENT,
          "TBL_ENCOUNTER": parameters.TBL_ENCOUNTER,
          "TBL_CURRENTSCHEDULE": parameters.TBL_CURRENTSCHEDULE
      }      
    }); 
    //Attach Lambda to DynamoDB stream
    lambdaEncounterListener.addEventSource(new DynamoEventSource(tblEncounter, {
      startingPosition: lambda.StartingPosition.LATEST,
    }));
    
    // Create log group for patientEngagement-currentScheduleListener
    //const patientEngagementCurrentScheduleListener = new logs.LogGroup(this, 'patientEngagement-currentScheduleListener', { logGroupName: '/aws/lambda/patientEngagement-currentScheduleListener' });        
    // IAM Policy and Role setup for patientEngagement-currentScheduleListener
    const lambdaCurrentScheduleListenerPolicy = new iam.Policy(this, 'ptf-lambda-currentSchedulelistener-policy', {
        policyName: 'ptf-currentSchedulelistener-policy',
        statements: [
        new iam.PolicyStatement({
          actions: ['logs:CreateLogGroup'],
          resources: ['*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['arn:aws:logs:'+parameters.REGION+':'+parameters.AWS_ACCOUNT_ID+':log-group:/aws/lambda/patientEngagement-CurrentScheduleListener:*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: [
                "ssm:PutParameter",
                "ssm:GetParameters",
                "ssm:GetParameter"
            ],
          resources: [
                "arn:aws:ssm:*:"+parameters.AWS_ACCOUNT_ID+":parameter/*"
            ],
          effect: iam.Effect.ALLOW,
        }),  
        new iam.PolicyStatement({
          actions: [
                "sms-voice:SetDefaultMessageType",
                "sms-voice:SetDefaultSenderId",
                "sms-voice:DescribePhoneNumbers",
                "ses:GetEmailIdentity",
                "ses:SendEmail",
                "mobiletargeting:TagResource",
                "ses:UntagResource",
                "ses:TagResource",
                "sms-voice:TagResource",
                "sms-voice:UntagResource",
                "mobiletargeting:UntagResource",
                "ses:GetConfigurationSet",
                "sms-voice:SendTextMessage"
            ],
          resources: [
                "arn:aws:sms-voice:*:"+parameters.AWS_ACCOUNT_ID+":phone-number/*",
                "arn:aws:sms-voice:*:"+parameters.AWS_ACCOUNT_ID+":configuration-set/*",
                "arn:aws:sms-voice:*:"+parameters.AWS_ACCOUNT_ID+":opt-out-list/*",
                "arn:aws:sms-voice:*:"+parameters.AWS_ACCOUNT_ID+":sender-id/*/*",
                "arn:aws:sms-voice:*:"+parameters.AWS_ACCOUNT_ID+":pool/*",
                "arn:aws:mobiletargeting:*:"+parameters.AWS_ACCOUNT_ID+":apps/*/campaigns/*",
                "arn:aws:mobiletargeting:*:"+parameters.AWS_ACCOUNT_ID+":apps/*/segments/*",
                "arn:aws:ses:*:"+parameters.AWS_ACCOUNT_ID+":configuration-set/*",
                "arn:aws:ses:*:"+parameters.AWS_ACCOUNT_ID+":dedicated-ip-pool/*",
                "arn:aws:ses:*:"+parameters.AWS_ACCOUNT_ID+":deliverability-test-report/*",
                "arn:aws:ses:*:"+parameters.AWS_ACCOUNT_ID+":identity/*"
            ],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: [
                "mobiletargeting:TagResource",
                "mobiletargeting:SendMessages",
                "mobiletargeting:UntagResource"
            ],
          resources: [
                "arn:aws:mobiletargeting:*:"+parameters.AWS_ACCOUNT_ID+":apps/*"            
            ],
          effect: iam.Effect.ALLOW,
        }),          
        new iam.PolicyStatement({
          actions: [
                "connect:StartTaskContact"
            ],
          resources: [
                "arn:aws:connect:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":instance/*"           
            ],
          effect: iam.Effect.ALLOW,
        }),          
        new iam.PolicyStatement({
          actions: [
                "dynamodb:BatchGet*",
                "dynamodb:Get*",
                "dynamodb:Query",
                "dynamodb:Scan"
            ],
          resources: [
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/CurrentSchedule",
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/CurrentSchedule/index/byEventDate"
            ],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: [
                "dynamodb:Put*"
            ],
          resources: [
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/EventResponse",
            ],
          effect: iam.Effect.ALLOW,
        })        
      ],
    });
    const lambdaCurrentScheduleListenerRole = new iam.Role(this, 'ptf-currentSchedulelistener-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'lambdaCurrentScheduleListenerRole',
      roleName: 'ptf-currentSchedulelistener-role'
    });
    lambdaCurrentScheduleListenerPolicy.attachToRole (lambdaCurrentScheduleListenerRole);    

    const lambdaCurrentScheduleListener = new lambda.Function(this, 'lambdaCurrentScheduleListenerHandler', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'patientEngagement-CurrentScheduleListener.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/lambda')),
      role: lambdaCurrentScheduleListenerRole,
      functionName: 'patientEngagement-CurrentScheduleListener',
      environment: {
          "TBL_CURRENTSCHEDULE": parameters.TBL_CURRENTSCHEDULE,
          "FROM_EMAIL": parameters.EMAIL_ID,
          "TBL_EVENTRESPONSE": parameters.TBL_EVENTRESPONSE,
          "ORIGINATION_NUMBER": parameters.ORIGINATION_NUMBER
      }      
    });  
    // Create EventBridge Scheduler for 1 min and associate patientEngagement-currentScheduleListener
    const targetLambdaFn = new targets.LambdaFunction (lambdaCurrentScheduleListener);
    const rule = new events.Rule(this, 'ptf-track-currentschedule-events-rule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [targetLambdaFn],
      ruleName: 'ptf-track-currentschedule-events-rule' 
    });   
    
    // Create log group for patientEngagement-TableOperations
    //const patientEngagementTableOperations = new logs.LogGroup(this, 'patientEngagement-tableOperations', { logGroupName: '/aws/lambda/patientEngagement-tableOperations' });     

    // IAM Policy and Role setup for patientEngagement-tableOperations
    const lambdaTableOperationsPolicy = new iam.Policy(this, 'ptf-lambda-tableOperations-policy', {
        policyName: 'ptf-tableOperations-policy',
        statements: [
        new iam.PolicyStatement({
          actions: ['logs:CreateLogGroup'],
          resources: ['*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['arn:aws:logs:'+parameters.REGION+':'+parameters.AWS_ACCOUNT_ID+':log-group:/aws/lambda/patientEngagement-TableOperations:*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: [
                "dynamodb:BatchGet*",
                "dynamodb:DescribeStream",
                "dynamodb:DescribeTable",
                "dynamodb:Get*",
                "dynamodb:Query",
                "dynamodb:Scan",
                "dynamodb:BatchWrite*",
                "dynamodb:CreateTable",
                "dynamodb:Delete*",
                "dynamodb:Update*",
                "dynamodb:PutItem"
            ],
          resources: [
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/Protocol", 
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/Event",
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/CurrentSchedule",
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/Encounter",
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/User",
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/EventResponse"
            ],
          effect: iam.Effect.ALLOW,
        })        
      ],
    });
    const lambdaTableOperationsRole = new iam.Role(this, 'ptf-tableOperations-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'lambdaTableOperationsRole',
      roleName: 'ptf-tableOperations-role'
    });
    lambdaTableOperationsPolicy.attachToRole (lambdaTableOperationsRole);    
    
    // Provision CRUD Table Operations Lambda
    const lambdaTableOperations = new lambda.Function(this, 'lambdaTableOperationsHandler', {
      runtime: lambda.Runtime.NODEJS_16_X,
      //handler: 'patientEngagement-tableOperations.handler',
      handler: 'patientEngagement-TableOperations.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/lambda')),
      role: lambdaTableOperationsRole,
      functionName: 'patientEngagement-TableOperations'
    }); 

    // Provision HTTP GW for TableOperations
    // 👇 create our HTTP Api
    const httpTableOperationsApi = new HttpApi(this, 'PatientEngagement-TableOperations-HttpApi', {
      description: 'PatientEngagement-TableOperations-HttpApi',
      corsPreflight: {
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
        ],
        allowMethods: [
          CorsHttpMethod.OPTIONS,
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
        ],
        allowCredentials: true
      },
    });
    
    // Define simple response authorizer to attach to routes
    // This function handles your auth logic
    const authorizerOperations = new HttpLambdaAuthorizer('authorizerOperations', lambdaSimpleAuthorizer, {
      responseTypes: [HttpLambdaResponseType.SIMPLE], // Define if returns simple and/or iam response
    });    
    
    // 👇 add route for GET /{tableName}
    httpTableOperationsApi.addRoutes({
      path: '/{tableName}',
      methods: [HttpMethod.GET],
      authorizer: authorizerOperations,
      integration: new HttpLambdaIntegration(
        'get-table-items',
        lambdaTableOperations
      ), 
    });  

    // 👇 add route for GET /{tableName}/{key}
    httpTableOperationsApi.addRoutes({
      path: '/{tableName}/{key}',
      methods: [HttpMethod.GET],
      authorizer: authorizerOperations,
      integration: new HttpLambdaIntegration(
        'get-table-item',
        lambdaTableOperations
      ),
    }); 
    
    // 👇 add route for POST /{tableName}
    httpTableOperationsApi.addRoutes({
      path: '/{tableName}',
      methods: [HttpMethod.POST],
      authorizer: authorizerOperations,
      integration: new HttpLambdaIntegration(
        'create-table-item',
        lambdaTableOperations
      ),
    });
    
    // 👇 add route for DELETE /{tableName}/{key}
    httpTableOperationsApi.addRoutes({
      path: '/{tableName}/{key}',
      methods: [HttpMethod.DELETE],
      authorizer: authorizerOperations,
      integration: new HttpLambdaIntegration(
        'delete-table-item',
        lambdaTableOperations
      ),
    }); 
    
    // 👇 add an Output with the API Url
    new cdk.CfnOutput(this, 'httpTableOperationsApiUrl', {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value: httpTableOperationsApi.url!,
      exportName: "TableOperationsApiBaseUrl"
    });

    // 👇 create sns topic
    const topic = new sns.Topic(this, 'sns-configure');
    /* 
     * IAM Policy and Role setup for patientEngagement-autoConfigure
     * SSM - get and put parameter
     * Connect - get List of Hours, put List of Hours, get list of Phonenumbers,  get List of Queues,
     * get List of Routing profiles, get List of Security profiles, get List of Contact flows, 
     * create Contact flow, get List of Users, create User.
     *
     */
    const lambdaAutoConfigurePolicy = new iam.Policy(this, 'ptf-lambda-autoConfigure-policy', {
        policyName: 'ptf-autoConfigure-policy',
        statements: [
        new iam.PolicyStatement({
          actions: ['logs:CreateLogGroup'],
          resources: ['*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['arn:aws:logs:'+parameters.REGION+':'+parameters.AWS_ACCOUNT_ID+':log-group:/aws/lambda/patientEngagement-AutoConfigure:*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: [
                "ssm:PutParameter",
                "ssm:GetParameters",
                "ssm:GetParameter"
            ],
          resources: [
                "arn:aws:ssm:*:"+parameters.AWS_ACCOUNT_ID+":parameter/*"
            ],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: [
                "sns:TagResource",
                "sns:ListSubscriptionsByTopic",
                "sns:Publish",
                "sns:GetTopicAttributes",
                "sns:SetTopicAttributes",
                "sns:Subscribe",
                "sns:UntagResource",
                "sns:SetSubscriptionAttributes",
                "sns:ListTopics",
                "sns:Unsubscribe",
                "sns:GetSubscriptionAttributes",
                "sns:ListSubscriptions"
            ],
          resources: [
                "arn:aws:sns:*:"+parameters.AWS_ACCOUNT_ID+":*"
            ],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: [
                "connect:ListPhoneNumbers",
                "connect:ListPhoneNumbersV2",
                "connect:ListQueues",
                "connect:CreateUser",
                "connect:ListContactFlows",
                "connect:TagResource",
                "connect:UntagResource",
                "connect:CreateHoursOfOperation",
                "connect:CreateContactFlow",
                "connect:ListUsers",
                "connect:ListRoutingProfiles",
                "connect:ListSecurityProfiles",
                "connect:ListHoursOfOperations"
            ],
          resources: [ "*" ],
          effect: iam.Effect.ALLOW,
        })
      ],
    });
    const lambdaAutoConfigureRole = new iam.Role(this, 'ptf-autoConfigure-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'lambdaAutoConfigureRole',
      roleName: 'ptf-autoConfigure-role'
    });
    lambdaAutoConfigurePolicy.attachToRole (lambdaAutoConfigureRole);    
     
    // Provision Autoconfigure Lambda
    const lambdaAutoConfigure= new lambda.Function(this, 'lambdaAutoConfigure', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'patientEngagement-AutoConfigure.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/lambda')),
      role: lambdaAutoConfigureRole,
      functionName: 'patientEngagement-AutoConfigure',
      timeout: cdk.Duration.seconds(29),
      environment: { 
          "CONTACT_FLOW" : JSON.stringify(parameters.CONTACT_FLOW) ,
          "CONNECT_ADMIN_USER": parameters.CONNECT_ADMIN_USER,
          "CONNECT_ADMIN_EMAIL": parameters.CONNECT_ADMIN_EMAIL,
          "CONNECT_ADMIN_FNAME": parameters.CONNECT_ADMIN_FNAME,
          "CONNECT_ADMIN_LNAME": parameters.CONNECT_ADMIN_LNAME,
          "CONNECT_ADMIN_PASSWORD": parameters.CONNECT_ADMIN_PASSWORD,
          "TOPIC_ARN": topic.topicArn
      }
    });  
    
    const lambdaConfigurePolicy = new iam.Policy(this, 'ptf-lambda-configure-policy', {
        policyName: 'ptf-configure-policy',
        statements: [
        new iam.PolicyStatement({
          actions: ['logs:CreateLogGroup'],
          resources: ['*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['arn:aws:logs:'+parameters.REGION+':'+parameters.AWS_ACCOUNT_ID+':log-group:/aws/lambda/patientEngagement-Configure:*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: [
                "sns:TagResource",
                "sns:ListSubscriptionsByTopic",
                "sns:Publish",
                "sns:GetTopicAttributes",
                "sns:SetTopicAttributes",
                "sns:Subscribe",
                "sns:UntagResource",
                "sns:SetSubscriptionAttributes",
                "sns:ListTopics",
                "sns:Unsubscribe",
                "sns:GetSubscriptionAttributes",
                "sns:ListSubscriptions"
            ],
          resources: [
                "arn:aws:sns:*:"+parameters.AWS_ACCOUNT_ID+":*"
            ],
          effect: iam.Effect.ALLOW,
        })
      ],
    });
    const lambdaConfigureRole = new iam.Role(this, 'ptf-configure-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'lambdaConfigureRole',
      roleName: 'ptf-configure-role'
    });
    lambdaConfigurePolicy.attachToRole (lambdaConfigureRole);    
    
    // Provision Configure Lambda
    const lambdaConfigure= new lambda.Function(this, 'lambdaConfigure', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'patientEngagement-Configure.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/lambda')),
      role: lambdaConfigureRole,
      functionName: 'patientEngagement-Configure',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        "TOPIC_ARN": topic.topicArn
      }
    });
    

    // Provision HTTP GW for Configure API
    // 👇 create our HTTP Api
    const httpConfigureApi = new HttpApi(this, 'PatientEngagement-Configure-HttpApi', {
      description: 'PatientEngagement-Configure-HttpApi',
      corsPreflight: {
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
        ],
        allowMethods: [
          CorsHttpMethod.OPTIONS,
          CorsHttpMethod.GET,
          CorsHttpMethod.POST
        ],
        allowCredentials: true
      },
    });
    
    // Define simple response authorizer to attach to routes
    // This function handles your auth logic
    const authorizerConfigure = new HttpLambdaAuthorizer('authorizerConfigure', lambdaSimpleAuthorizer, {
      responseTypes: [HttpLambdaResponseType.SIMPLE], // Define if returns simple and/or iam response
    });   
    
    // 👇 add route for POST /configure
    httpConfigureApi.addRoutes({
      path: '/configure',
      methods: [HttpMethod.POST],
      authorizer: authorizerConfigure,
      integration: new HttpLambdaIntegration(
        'Place configure message onto SNS ',
        lambdaConfigure
      ),
    }); 
    
    // Lambda should receive only message matching the following conditions on attributes:
    // action: 'configure'
    topic.addSubscription(new subs.LambdaSubscription(lambdaAutoConfigure, {
      filterPolicy: {
        action: sns.SubscriptionFilter.stringFilter({
          allowlist: ['configure']
        })
      },
    }));

    // Email should receive only message matching the following conditions on attributes:
    // action: 'status'
    topic.addSubscription(new subs.EmailSubscription(parameters.CONNECT_ADMIN_EMAIL, {
      filterPolicy: {
        action: sns.SubscriptionFilter.stringFilter({
          allowlist: ['status']
        })
      },
    }));
  
    // 👇 add an Output with the API Url
    new cdk.CfnOutput(this, 'httpConfigureApiUrl', {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value: httpConfigureApi.url!,
      exportName: "ConfigureApiBaseUrl"
    });
    
    var configureCurl = "curl -H \"Authorization: <YourConnectAdminPassword>\" -X POST " +httpConfigureApi.url!+"configure";
    // 👇 add an Output with the CURL command for configure
    new cdk.CfnOutput(this, 'configureCurlCommand', {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value: configureCurl,
      exportName: "ConfigureCurlCommand"
    });     
    
    // 👇 Output the ready curl commands for setting up the demo data
    var patientCurl = "curl -H \"Content-Type: application/json\" -H \"Authorization: <YourConnectAdminPassword>\" -X POST " +httpTableOperationsApi.url!+"User -d @./test/patient_john.json";
    var protocolCurl = "curl -H \"Content-Type: application/json\" -H \"Authorization: <YourConnectAdminPassword>\" -X POST " +httpTableOperationsApi.url!+"Protocol -d @./test/protocol_db.json";
    var eventCurl1 = "curl -H \"Content-Type: application/json\" -H \"Authorization: <YourConnectAdminPassword>\" -X POST " +httpTableOperationsApi.url!+"Event -d @./test/event_1.json";
    var eventCurl2 = "curl -H \"Content-Type: application/json\" -H \"Authorization: <YourConnectAdminPassword>\" -X POST " +httpTableOperationsApi.url!+"Event -d @./test/event_2.json";
    var eventCurl3 = "curl -H \"Content-Type: application/json\" -H \"Authorization: <YourConnectAdminPassword>\" -X POST " +httpTableOperationsApi.url!+"Event -d @./test/event_3.json";
    var encounterCurl = "curl -H \"Content-Type: application/json\" -H \"Authorization: <YourConnectAdminPassword>\" -X POST " +httpTableOperationsApi.url!+"Encounter -d @./test/encounter_john_db.json";
    
    new cdk.CfnOutput(this, 'patientCurlCommand', {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value: patientCurl,
      exportName: "PatientCurlCommand"
    });
    new cdk.CfnOutput(this, 'protocolCurlCommand', {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value: protocolCurl,
      exportName: "ProtocolCurlCommand"
    });
    new cdk.CfnOutput(this, 'event1CurlCommand', {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value: eventCurl1,
      exportName: "Event1CurlCommand"
    }); 
    new cdk.CfnOutput(this, 'event2CurlCommand', {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value: eventCurl2,
      exportName: "Event2CurlCommand"
    });  
    new cdk.CfnOutput(this, 'event3CurlCommand', {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value: eventCurl3,
      exportName: "Event3CurlCommand"
    }); 
    new cdk.CfnOutput(this, 'encounterCurlCommand', {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value: encounterCurl,
      exportName: "EncounterCurlCommand"
    });  
    
    // 👇 create sns topic for SMS response processing 
    const topicSMSResponse = new sns.Topic(this, 'sms-response-process');

    
    const lambdaSMSResponseProcessorPolicy = new iam.Policy(this, 'ptf-lambda-smsresponseprocessor-policy', {
        policyName: 'ptf-smsresponseprocessor-policy',
        statements: [
        new iam.PolicyStatement({
          actions: ['logs:CreateLogGroup'],
          resources: ['*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['arn:aws:logs:'+parameters.REGION+':'+parameters.AWS_ACCOUNT_ID+':log-group:/aws/lambda/patientEngagement-SMSResponseProcessor:*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: [
                "sns:ListSubscriptionsByTopic",
                "sns:GetTopicAttributes",
                "sns:Subscribe",
                "sns:ListTopics",
                "sns:Unsubscribe",
                "sns:GetSubscriptionAttributes",
                "sns:ListSubscriptions"
            ],
          resources: [
                "arn:aws:sns:*:"+parameters.AWS_ACCOUNT_ID+":*"
            ],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: [
                "dynamodb:Put*",
                "dynamodb:Update*"
            ],
          resources: [
                "arn:aws:dynamodb:"+parameters.REGION+":"+parameters.AWS_ACCOUNT_ID+":table/EventResponse",
            ],
          effect: iam.Effect.ALLOW,
        })          
      ],
    });
    const lambdaSMSResponseProcessorRole = new iam.Role(this, 'ptf-smsresponseprocessor-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'lambdaSMSResponseProcessorRole',
      roleName: 'ptf-smsresponseprocessor-role'
    });
    lambdaSMSResponseProcessorPolicy.attachToRole (lambdaSMSResponseProcessorRole);    
    
    // Provision SMSResponseProcessor Lambda
    const lambdaSMSResponseProcessor= new lambda.Function(this, 'lambdaSMSResponseProcessor', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'patientEngagement-SMSResponseProcessor.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/lambda')),
      role: lambdaSMSResponseProcessorRole,
      functionName: 'patientEngagement-SMSResponseProcessor',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        "TOPIC_ARN": topicSMSResponse.topicArn,
        "TBL_EVENTRESPONSE": parameters.TBL_EVENTRESPONSE
      }
    });
    
    // Lambda receives SMS messsage as received by Toll free number; Ensure to configure this topic in Amazon Pinpoin Tollfree number's 2 way configuration manually.
    topicSMSResponse.addSubscription(new subs.LambdaSubscription(lambdaSMSResponseProcessor));    
    new cdk.CfnOutput(this, 'SMSResponseTopic', {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value: topicSMSResponse.topicArn,
      exportName: "SMSResponseTopicARN"
    });    
  }
}
