import Component from '@ember/component';
import ComputedProperty, { equal } from '@ember/object/computed';
import { inject } from '@ember/service';
import { get, set, getProperties, computed } from '@ember/object';
import { task, TaskInstance } from 'ember-concurrency';
import { action } from 'ember-decorators/object';
import { isUserInAcl } from 'wherehows-web/constants/dataset-aclaccess';
import CurrentUser from 'wherehows-web/services/current-user';
import { IUser } from 'wherehows-web/typings/api/authentication/user';
import {
  IAccessControlAccessTypeOption,
  IAccessControlEntry,
  IRequestAccessControlEntry
} from 'wherehows-web/typings/api/datasets/aclaccess';
import { readDatasetAcls, removeAclAccess, requestAclAccess } from 'wherehows-web/utils/api/datasets/acl-access';
import {
  AccessControlAccessType,
  getAccessControlTypeOptions,
  getDefaultRequestAccessControlEntry
} from 'wherehows-web/utils/datasets/acl-access';
import { hasEnumerableKeys } from 'wherehows-web/utils/object';
import Notifications, { NotificationEvent } from 'wherehows-web/services/notifications';

export default class DatasetAclAccessContainer extends Component {
  /**
   * The currently logged in user service
   * @type {ComputedProperty<CurrentUser>}
   * @memberof DatasetAclAccessContainer
   */
  currentUser: ComputedProperty<CurrentUser> = inject();

  /**
   * App notifications service
   * @type {ComputedProperty<Notifications>}
   * @memberof DatasetAclAccessContainer
   */
  notifications: ComputedProperty<Notifications> = inject();

  /**
   * The currently logged in user
   * @type {IUser}
   * @memberof DatasetAclAccessContainer
   */
  user: IUser;

  /**
   * The list of acls
   * @type {Array<IAccessControlEntry>}
   * @memberof DatasetAclAccessContainer
   */
  acls: Array<IAccessControlEntry> = [];

  /**
   * The user's acl entry if exists
   * @type {Array<IAccessControlEntry>}
   * @memberof DatasetAclAccessContainer
   */
  userAcl: Array<IAccessControlEntry> = [];

  /**
   * Request object for the current user requesting access control
   * @type {IRequestAccessControlEntry}
   * @memberof DatasetAclAccessContainer
   */
  userAclRequest: IRequestAccessControlEntry = getDefaultRequestAccessControlEntry();

  /**
   * Lists dropdown options for acl access type
   * @type {Array<IAccessControlAccessTypeOption>}
   * @memberof DatasetAclAccessContainer
   */
  accessTypeDropDownOptions: Array<IAccessControlAccessTypeOption> = getAccessControlTypeOptions(<Array<
    AccessControlAccessType
  >>Object.values(AccessControlAccessType));

  /**
   * Checks if there is a acl entry in the userAcl tuple
   * @type {ComputedProperty<boolean>}
   * @memberof DatasetAclAccessContainer
   */
  userHasAclAccess = equal('userAcl.length', 1);

  /**
   * Dataset urn
   * @type {string}
   * @memberof DatasetAclAccessContainer
   */
  urn: string;

  didInsertElement() {
    get(this, 'getContainerDataTask').perform();
  }

  didUpdateAttrs() {
    get(this, 'getContainerDataTask').perform();
  }

  /**
   * Checks if the acl request entry object is valid / correctly entered
   * @type {ComputedProperty<boolean>}
   * @memberof DatasetAclAccessContainer
   */
  hasValidAclRequest = computed('userAclRequest.businessJustification', function(
    this: DatasetAclAccessContainer
  ): boolean {
    const userAclRequest = get(this, 'userAclRequest');
    return hasEnumerableKeys(userAclRequest) && !!userAclRequest.businessJustification;
  });

  /**
   * Notifies user of changes to acl access
   * @param {(string | Error)} param notification message string or error object
   * @returns {void}
   * @memberof DatasetAclAccessContainer
   */
  notifyStatus(this: DatasetAclAccessContainer, param: string | Error) {
    const { notify } = get(this, 'notifications');

    if (typeof param === 'string') {
      return notify(NotificationEvent.success, { content: param });
    }

    notify(NotificationEvent.error, { content: param.message });
  }

  /**
   * Parent container task to get all data for the container component
   * @memberof DatasetAclAccessContainer
   */
  getContainerDataTask = task(function*(this: DatasetAclAccessContainer): IterableIterator<any> {
    const { getCurrentUserTask, getDatasetAclsTask, checkUserAccessTask } = getProperties(this, [
      'getCurrentUserTask',
      'getDatasetAclsTask',
      'checkUserAccessTask'
    ]);

    const user: DatasetAclAccessContainer['user'] = yield getCurrentUserTask.perform();

    if (user) {
      yield getDatasetAclsTask.perform();
      yield checkUserAccessTask.perform();
    }
  });

  /**
   * Fetches the current logged in user
   * @memberof DatasetAclAccessContainer
   */
  getCurrentUserTask = task(function*(this: DatasetAclAccessContainer): IterableIterator<IUser> {
    const { currentUser } = get(this, 'currentUser');

    return set(this, 'user', currentUser);
  });

  /**
   * Fetches the list of acls for this dataset
   * @memberof DatasetAclAccessContainer
   */
  getDatasetAclsTask = task(function*(
    this: DatasetAclAccessContainer
  ): IterableIterator<Promise<Array<IAccessControlEntry>>> {
    return set(this, 'acls', yield readDatasetAcls(get(this, 'urn')));
  });

  /**
   * Checks if the current user has access to the acl
   * @memberof DatasetAclAccessContainer
   */
  checkUserAccessTask = task(function*(this: DatasetAclAccessContainer): IterableIterator<Array<IAccessControlEntry>> {
    const { user: { userName }, acls } = getProperties(this, ['user', 'acls']);
    const userAcl: Array<IAccessControlEntry> = yield isUserInAcl(userName)(acls);

    return get(this, 'userAcl').setObjects(userAcl);
  }).drop();

  /**
   * Requests the current user be added to the acl
   * @memberof DatasetAclAccessContainer
   */
  requestAccessTask = task(function*(this: DatasetAclAccessContainer): IterableIterator<Promise<void>> {
    if (get(this, 'hasValidAclRequest')) {
      yield requestAclAccess(get(this, 'urn'), get(this, 'userAclRequest'));
    }
  }).drop();

  /**
   * Requests access for the current user, get the dataset acl
   * @memberof DatasetAclAccessContainer
   */
  requestAccessAndCheckAccessTask = task(function*(this: DatasetAclAccessContainer): IterableIterator<any> {
    try {
      yield get(this, 'requestAccessTask').perform();
      yield get(this, 'getDatasetAclsTask').perform();
      yield get(this, 'checkUserAccessTask').perform();

      get(this, 'userHasAclAccess') && this.notifyStatus('Congrats, your request has been approved!');
    } catch (e) {
      this.notifyStatus(e);
    }
  }).drop();

  /**
   * Requests the current user be removed from the dataset's acl
   * @memberof DatasetAclAccessContainer
   */
  removeAccessTask = task(function*(
    this: DatasetAclAccessContainer
  ): IterableIterator<
    Promise<void> | TaskInstance<Array<IAccessControlEntry>> | TaskInstance<Promise<IAccessControlEntry[]>>
  > {
    try {
      yield removeAclAccess(get(this, 'urn'));
      yield get(this, 'getDatasetAclsTask').perform();
      yield get(this, 'checkUserAccessTask').perform();

      !get(this, 'userHasAclAccess') && this.notifyStatus('Your access has been removed');
    } catch (e) {
      this.notifyStatus(e);
    }
  }).drop();

  /**
   * Sets the accessType attribute on the user's acl access request object
   * @param {IAccessControlAccessTypeOption} { value }
   * @memberof DatasetAclAccessContainer
   */
  @action
  accessTypeDidChange({ value }: IAccessControlAccessTypeOption) {
    //@ts-ignore object property access path notation limitation
    set(this, 'userAclRequest.accessType', value);
  }

  /**
   * Sets the expiresAt attribute timestamp in seconds
   * @param {Date} date the expiration date object
   */
  @action
  expiresAtDidChange(date: Date) {
    //@ts-ignore object property access path notation limitation
    set(this, 'userAclRequest.expiresAt', date.getTime() / 1000);
  }
}
