targetScope = 'resourceGroup'

@description('Azure region for the Logic App. Defaults to the resource group region.')
param location string = resourceGroup().location

@description('Name of the Logic App workflow resource.')
param logicAppName string = 'logic-yetanotherquiz-release-daily'

@description('GitHub fine-grained PAT with Actions: write on jgrzegrzolka/gridgame. Passed at deploy time, never committed.')
@secure()
param githubPat string

resource releaseDaily 'Microsoft.Logic/workflows@2019-05-01' = {
  name: logicAppName
  location: location
  tags: {
    purpose: 'release-daily-puzzle'
    managedBy: 'bicep'
  }
  properties: {
    state: 'Enabled'
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: {
        githubPat: {
          type: 'securestring'
        }
      }
      triggers: {
        dailyRecurrence: {
          type: 'Recurrence'
          recurrence: {
            frequency: 'Day'
            interval: 1
            schedule: {
              hours: [0]
              minutes: [5]
            }
            timeZone: 'Central European Standard Time'
          }
        }
      }
      actions: {
        dispatchReleaseDaily: {
          type: 'Http'
          inputs: {
            method: 'POST'
            uri: 'https://api.github.com/repos/jgrzegrzolka/gridgame/actions/workflows/release-daily.yml/dispatches'
            headers: {
              Authorization: 'Bearer @{parameters(\'githubPat\')}'
              Accept: 'application/vnd.github+json'
              'X-GitHub-Api-Version': '2022-11-28'
              'User-Agent': 'yetanotherquiz-logicapp'
            }
            body: {
              ref: 'main'
            }
          }
        }
      }
    }
    parameters: {
      githubPat: {
        value: githubPat
      }
    }
  }
}

output logicAppName string = releaseDaily.name
output logicAppLocation string = releaseDaily.location
