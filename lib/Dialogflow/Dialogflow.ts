import { IHttp, IHttpRequest, IHttpResponse, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { AppSetting } from '../../config/Settings';
import { IDialogflowAccessToken, IDialogflowMessage, IDialogflowQuickReply } from '../../enum/Dialogflow';
import { Persistence } from '../persistence';
import { getAppSettingValue } from '../Settings';
import { DialogflowAuth } from './DialogflowAuth';

class DialogflowClass {
    public async sendMessage(http: IHttp,
                             read: IRead,
                             persis: IPersistence,
                             sessionId: string,
                             messageText: string): Promise<IDialogflowMessage> {
        const dialogflowServerURL = await this.getDialogflowURL(read, persis, http, sessionId);

        const httpRequestContent: IHttpRequest = this.buildDialogflowHTTPRequest(messageText);

        // send request to dialogflow
        const response = await http.post(dialogflowServerURL, httpRequestContent);

        return this.parseDialogflowRequest(response);
    }

    private parseDialogflowRequest(response: IHttpResponse): IDialogflowMessage {
        if (!response.content) { throw new Error('Error Parsing Dialogflow\'s Response. Content is undefined'); }
        const responseJSON = JSON.parse(response.content);

        if (responseJSON.queryResult) {

            const parsedMessage: IDialogflowMessage = {
                message: responseJSON.queryResult.fulfillmentText,
                isFallback: responseJSON.queryResult.intent.isFallback ? responseJSON.queryResult.intent.isFallback : false,
            };

            const quickReplies: Array<IDialogflowQuickReply> = [];
            responseJSON.queryResult.fulfillmentMessages.forEach((e) => {
                if (e.payload && e.payload.quick_replies) {
                    e.payload.quick_replies.forEach((quickReply: IDialogflowQuickReply) => {
                        quickReplies.push(quickReply);
                    });
                }
            });

            if (quickReplies.length > 0) {
                parsedMessage.quickReplies = quickReplies;
            }

            return parsedMessage;
        } else {
            // some error occured. Dialogflow's response has a error field containing more info abt error
            throw Error(`An Error occured while connecting to Dialogflows REST API\
            Error Details:-
                message:- ${responseJSON.error.message}\
                status:- ${responseJSON.error.message}\
            Try checking the google credentials in App Setting and your internet connection`);
        }
    }

    private async getDialogflowURL(read: IRead, persis: IPersistence, http: IHttp, sessionId: string) {
        const projectId = await getAppSettingValue(read, AppSetting.DialogflowProjectId);

        const accessToken = await this.getAccessToken(read, persis, http, sessionId);
        if (!accessToken) { throw Error('Error getting Access Token. Access token is undefined'); }

        const dialogflowServerURL = `https://dialogflow.googleapis.com/v2/projects/${projectId}/agent/environments/draft/users/-/sessions/${sessionId}:detectIntent?access_token=${accessToken}`;
        return dialogflowServerURL;
    }

    private async getAccessToken(read: IRead, persis: IPersistence, http: IHttp, sessionId: string) {

        const clientEmail = await getAppSettingValue(read, AppSetting.DialogflowClientEmail);
        if (!clientEmail) { throw new Error('Error! Client email not provided in setting'); }
        const privateKey = await getAppSettingValue(read, AppSetting.DialogFlowPrivateKey);
        if (!privateKey) { throw new Error('Error! Private Key not provided in setting'); }

        // check is there is a valid access token already present
        const oldAccessToken: IDialogflowAccessToken = (await Persistence.getConnectedAccessToken(
                                                                            read.getPersistenceReader(),
                                                                            sessionId)) as IDialogflowAccessToken;
        if (oldAccessToken) {
            // check expiration
            if (!this.hasExpired(oldAccessToken.expiration)) {
                return oldAccessToken.token;
            }
        }

        try {
            // get the access token
            const accessToken: IDialogflowAccessToken =  await new DialogflowAuth(clientEmail, privateKey).getAccessToken(http);
            // save this token to persistant storage for caching
            await Persistence.connectAccessTokenToSessionId(persis, sessionId, accessToken);

            return accessToken.token;
        } catch (error) {
            throw Error('Error getting Access Token' + error);
        }
    }

    private buildDialogflowHTTPRequest(message: string) {
        return {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            data: {
                queryInput: {
                    text: {
                    languageCode: 'en',
                    text: message,
                    },
                },
            },
        };
    }

    private hasExpired(expiration: Date): boolean {
        if (!expiration) { return true; }
        return Date.now() >= expiration.getTime();
    }
}

export const Dialogflow = new DialogflowClass();