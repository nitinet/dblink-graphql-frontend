var __decorate =
  (this && this.__decorate) ||
  function (decorators, target, key, desc) {
    var c = arguments.length,
      r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc,
      d;
    if (typeof Reflect === 'object' && typeof Reflect.decorate === 'function') r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if ((d = decorators[i])) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return (c > 3 && r && Object.defineProperty(target, key, r), r);
  };
var __metadata =
  (this && this.__metadata) ||
  function (k, v) {
    if (typeof Reflect === 'object' && typeof Reflect.metadata === 'function') return Reflect.metadata(k, v);
  };
import { Context, collection, decorators } from 'dblink';
const { Table, Column, Id } = decorators;
export function createUserEntity(tableName) {
  let User = class User {
    id = 0;
    name = '';
    email = '';
  };
  __decorate([Id, Column('id'), __metadata('design:type', Number)], User.prototype, 'id', void 0);
  __decorate([Column('name'), __metadata('design:type', String)], User.prototype, 'name', void 0);
  __decorate([Column('email'), __metadata('design:type', String)], User.prototype, 'email', void 0);
  User = __decorate([Table(tableName)], User);
  return User;
}
export function createOrderEntity(tableName) {
  let Order = class Order {
    orderId = 0;
    userId = 0;
    amount = 0;
  };
  __decorate([Id, Column('order_id'), __metadata('design:type', Number)], Order.prototype, 'orderId', void 0);
  __decorate([Column('user_id'), __metadata('design:type', Number)], Order.prototype, 'userId', void 0);
  __decorate([Column('amount'), __metadata('design:type', Number)], Order.prototype, 'amount', void 0);
  Order = __decorate([Table(tableName)], Order);
  return Order;
}
export function createAppContext(UserEntity, OrderEntity) {
  class AppContext extends Context {
    users = new collection.TableSet(UserEntity);
    orders = new collection.TableSet(OrderEntity);
  }
  return AppContext;
}
export class EmptyContext extends Context {}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9kZWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibW9kZWxzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLE9BQU8sRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRSxNQUFNLFFBQVEsQ0FBQztBQUV6RCxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsR0FBRyxVQUFVLENBQUM7QUFPekMsTUFBTSxVQUFVLGdCQUFnQixDQUFDLFNBQWlCO0lBRWhELElBQU0sSUFBSSxHQUFWLE1BQU0sSUFBSTtRQUNVLEVBQUUsR0FBVyxDQUFDLENBQUM7UUFDakIsSUFBSSxHQUFXLEVBQUUsQ0FBQztRQUNqQixLQUFLLEdBQVcsRUFBRSxDQUFDO0tBQ3JDLENBQUE7SUFIbUI7UUFBakIsRUFBRTtRQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUM7O29DQUFnQjtJQUNqQjtRQUFmLE1BQU0sQ0FBQyxNQUFNLENBQUM7O3NDQUFtQjtJQUNqQjtRQUFoQixNQUFNLENBQUMsT0FBTyxDQUFDOzt1Q0FBb0I7SUFIaEMsSUFBSTtRQURULEtBQUssQ0FBQyxTQUFTLENBQUM7T0FDWCxJQUFJLENBSVQ7SUFDRCxPQUFPLElBQUksQ0FBQztBQUNkLENBQUM7QUFTRCxNQUFNLFVBQVUsaUJBQWlCLENBQUMsU0FBaUI7SUFFakQsSUFBTSxLQUFLLEdBQVgsTUFBTSxLQUFLO1FBQ2UsT0FBTyxHQUFXLENBQUMsQ0FBQztRQUN6QixNQUFNLEdBQVcsQ0FBQyxDQUFDO1FBQ3BCLE1BQU0sR0FBVyxDQUFDLENBQUM7S0FDdEMsQ0FBQTtJQUh5QjtRQUF2QixFQUFFO1FBQUUsTUFBTSxDQUFDLFVBQVUsQ0FBQzs7MENBQXFCO0lBQ3pCO1FBQWxCLE1BQU0sQ0FBQyxTQUFTLENBQUM7O3lDQUFvQjtJQUNwQjtRQUFqQixNQUFNLENBQUMsUUFBUSxDQUFDOzt5Q0FBb0I7SUFIakMsS0FBSztRQURWLEtBQUssQ0FBQyxTQUFTLENBQUM7T0FDWCxLQUFLLENBSVY7SUFDRCxPQUFPLEtBQUssQ0FBQztBQUNmLENBQUM7QUFVRCxNQUFNLFVBQVUsZ0JBQWdCLENBQXFDLFVBQXlCLEVBQUUsV0FBMEI7SUFDeEgsTUFBTSxVQUFXLFNBQVEsT0FBTztRQUM5QixLQUFLLEdBQUcsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQzVDLE1BQU0sR0FBRyxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLENBQUM7S0FDL0M7SUFDRCxPQUFPLFVBQVUsQ0FBQztBQUNwQixDQUFDO0FBR0QsTUFBTSxPQUFPLFlBQWEsU0FBUSxPQUFPO0NBQUcifQ==
