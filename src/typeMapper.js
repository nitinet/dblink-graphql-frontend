import { GraphQLBoolean, GraphQLFloat, GraphQLID, GraphQLString } from 'graphql';
export function jsTypeToGraphQL(dataType, isPrimaryKey) {
  if (isPrimaryKey) return GraphQLID;
  switch (dataType) {
    case String:
      return GraphQLString;
    case Number:
      return GraphQLFloat;
    case Boolean:
      return GraphQLBoolean;
    default:
      return GraphQLString;
  }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZU1hcHBlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInR5cGVNYXBwZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLGNBQWMsRUFBRSxZQUFZLEVBQUUsU0FBUyxFQUFxQixhQUFhLEVBQUUsTUFBTSxTQUFTLENBQUM7QUFNcEcsTUFBTSxVQUFVLGVBQWUsQ0FBQyxRQUFpQixFQUFFLFlBQXFCO0lBQ3RFLElBQUksWUFBWTtRQUFFLE9BQU8sU0FBUyxDQUFDO0lBQ25DLFFBQVEsUUFBUSxFQUFFLENBQUM7UUFDakIsS0FBSyxNQUFNO1lBQ1QsT0FBTyxhQUFhLENBQUM7UUFDdkIsS0FBSyxNQUFNO1lBQ1QsT0FBTyxZQUFZLENBQUM7UUFDdEIsS0FBSyxPQUFPO1lBQ1YsT0FBTyxjQUFjLENBQUM7UUFDeEI7WUFDRSxPQUFPLGFBQWEsQ0FBQztJQUN6QixDQUFDO0FBQ0gsQ0FBQyJ9
