{
  "$id": "xzr.public.output.reports.v1",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Publishes X&Z report",
  "description": "Publishes generated PDF with X&Z reports",
  "type": "object",
  "properties": {
    "type": {
      "$ref": "#/$defs/ReportTypeEnum"
    },
    "operatorIds": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "The country code of transaction."
    },
    "businessUnitId": {
      "type": "string",
      "description": "The businessUnitId of the report."
    },
    "workstationId": {
      "type": "string",
      "description": "The workstation of the report."
    },
    "createdAt": {
      "type": "string",
      "format": "date-time",
      "description": "The creation date of report."
    },
    "data": {
      "type": "string",
      "description": "Base64 represintation of Report PDF"
    }
  },
  "$defs": {
    "ReportTypeEnum": {
      "type": "string",
      "enum": [
        "x",
        "z"
      ]
    }
  },
  "required": [
    "operatorIds",
    "businessUnitId",
    "workstationId",
    "createdAt",
    "data",
    "type",
    "operatorIds"
  ]
}
